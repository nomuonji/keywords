import { z } from 'zod';

// Macroeconomic strategy is a replaceable record. Admission and allocation
// are reusable mechanics and never encode the active 40/40/20 thesis.
const key = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const taskKind = z.enum(['revise','merge','delete','internal_links','technical','new_article','site_expansion','data_expansion','schema_expansion']);
const incidentIntake = z.enum(['allow','clearance_required']);
export const seoPortfolioPolicyDefinition = z.object({
  objective: z.object({ metric: z.enum(['gsc_clicks','gsc_impressions','organic_sessions']), optimization: z.enum(['maximize','stabilize','restore']), scope: z.literal('active_managed_sites') }).strict(),
  allocation: z.object({ buckets: z.array(z.object({
    id: key, label: z.string().trim().min(1).max(100), targetPercent: z.number().int().min(0).max(100),
    thesis: z.string().trim().min(1).max(600)
  }).strict()).min(1).max(10), unit: z.literal('estimated_effort_units'), mode: z.enum(['guidance','target']), unallocatedAllowed: z.boolean() }).strict(),
  risk: z.object({ appetite: z.enum(['conservative','balanced','aggressive']), maxNewTasksPerRun: z.number().int().min(0).max(20),
    maxNewTasksPerRepository: z.number().int().min(0).max(10), maxEstimatedEffortUnitsPerTask: z.number().int().min(1).max(40),
    independentBets: z.boolean() }).strict(),
  constraints: z.object({ incidentGrowthIntake: z.object({
      search_visibility: incidentIntake,
      content_quality: incidentIntake,
      technical_integrity: incidentIntake,
      measurement_integrity: incidentIntake,
      other: incidentIntake
    }).strict(),
    protectedTaskTypes: z.array(taskKind).max(9), majorDirectionRequiresDecision: z.literal(true),
    preserveDeliveryHandoffs: z.literal(true), noScaledLowValuePages: z.literal(true) }).strict(),
  evaluation: z.object({ portfolioReviewDays: z.number().int().min(1).max(90),
    pilotWindowDays: z.array(z.number().int().min(1).max(180)).length(2),
    reallocationWindowDays: z.array(z.number().int().min(1).max(365)).length(2),
    evidenceRule: z.literal('missing_is_unknown') }).strict()
}).strict().superRefine((p,ctx)=>{
  if(new Set(p.allocation.buckets.map(x=>x.id)).size!==p.allocation.buckets.length)
    ctx.addIssue({code:'custom',path:['allocation','buckets'],message:'Duplicate bucket IDs'});
  if(p.allocation.buckets.reduce((s,x)=>s+x.targetPercent,0)!==100)
    ctx.addIssue({code:'custom',path:['allocation','buckets'],message:'Bucket percentages must total 100'});
  if(p.evaluation.pilotWindowDays[0]>90 || p.evaluation.reallocationWindowDays[0]>180 ||
     p.evaluation.pilotWindowDays[0]>p.evaluation.pilotWindowDays[1] ||
     p.evaluation.reallocationWindowDays[0]>p.evaluation.reallocationWindowDays[1])
    ctx.addIssue({code:'custom',path:['evaluation'],message:'Evaluation windows must be ascending'});
});
export type SeoPortfolioPolicyDefinition=z.infer<typeof seoPortfolioPolicyDefinition>;
export type SeoPortfolioPolicyRecord=SeoPortfolioPolicyDefinition&{
  id:'organic-search';revision:number;createdAt:string;updatedAt:string;decisionReason:string;updatedBy:string
};
export const DEFAULT_SEO_PORTFOLIO_POLICY:SeoPortfolioPolicyDefinition={
  objective:{metric:'gsc_clicks',optimization:'maximize',scope:'active_managed_sites'},
  allocation:{unit:'estimated_effort_units',mode:'guidance',unallocatedAllowed:true,buckets:[
    {id:'proven_demand',label:'Demand concentration',targetPercent:40,thesis:'Useful Search experiences around observed demand'},
    {id:'structural',label:'Structural rebuilds',targetPercent:40,thesis:'Site/page-family structure, navigation and sourced coverage'},
    {id:'speculative',label:'Asymmetric pilots',targetPercent:20,thesis:'Independent uncertain high-upside organic Search approaches'}
  ]},
  risk:{appetite:'aggressive',maxNewTasksPerRun:5,maxNewTasksPerRepository:3,maxEstimatedEffortUnitsPerTask:12,independentBets:true},
  constraints:{incidentGrowthIntake:{search_visibility:'allow',content_quality:'clearance_required',
    technical_integrity:'clearance_required',measurement_integrity:'clearance_required',other:'clearance_required'},
    protectedTaskTypes:['new_article','site_expansion','data_expansion','schema_expansion'],
    majorDirectionRequiresDecision:true,preserveDeliveryHandoffs:true,noScaledLowValuePages:true},
  evaluation:{portfolioReviewDays:7,pilotWindowDays:[14,28],reallocationWindowDays:[30,60],evidenceRule:'missing_is_unknown'}
};
export const defaultSeoPortfolioPolicyRecord=():SeoPortfolioPolicyRecord=>({
  id:'organic-search',revision:0,createdAt:'',updatedAt:'',decisionReason:'Default before first explicit policy update',updatedBy:'system_default',...DEFAULT_SEO_PORTFOLIO_POLICY
});
export function growthIntakeDecision(policy:SeoPortfolioPolicyDefinition,mode:'normal'|'recovery',
  category:keyof SeoPortfolioPolicyDefinition['constraints']['incidentGrowthIntake'],taskType:string,cleared:boolean){
  if(mode==='normal'||!policy.constraints.protectedTaskTypes.some(t=>t===taskType))
    return {allowed:true,reason:'Unrestricted task'};
  if(policy.constraints.incidentGrowthIntake[category]==='allow'||cleared)
    return {allowed:true,reason:'Permitted by active policy or incident clearance'};
  return {allowed:false,reason:'Site-specific clearance required by active policy'};
}
export function allocationSnapshot(policy:SeoPortfolioPolicyDefinition,tasks:Array<{
  status:string;allocationBucket?:string|null;estimatedEffortUnits?:number|null
}>){
  const active=tasks.filter(t=>['ready','issued','in_progress'].includes(t.status));
  const buckets=policy.allocation.buckets.map(b=>{
    const rows=active.filter(t=>t.allocationBucket===b.id);
    return {id:b.id,targetPercent:b.targetPercent,estimatedEffortUnits:rows.reduce((sum,r)=>sum+(r.estimatedEffortUnits??0),0),assignedTasks:rows.length};
  });
  const total=buckets.reduce((sum,b)=>sum+b.estimatedEffortUnits,0);
  return {unit:policy.allocation.unit,totalAssignedEffortUnits:total,
    unallocatedTaskCount:active.length-buckets.reduce((sum,b)=>sum+b.assignedTasks,0),
    buckets:buckets.map(b=>({...b,shareOfAssignedPercent:total?Math.round(b.estimatedEffortUnits/total*1000)/10:null})),
    caveat:'Estimates of planned capacity only; not elapsed hours, search results or financial returns'};
}
