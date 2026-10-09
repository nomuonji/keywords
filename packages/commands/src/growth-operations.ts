import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { field, value, firestore, FirestoreError } from '../../db/src/firestore.js';
import { auditWriteBatch, siteRegistryGet } from './remote-site-operations.js';

const id = z.string().trim().min(1).max(140).regex(/^[a-zA-Z0-9_-]+$/);
const text = z.string().trim().min(1).max(2000);
const url = z.string().url().refine(x => /^https:\/\//.test(x), 'HTTPS URL required');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().datetime({ offset: true });
const initiativeStatus = z.enum(['researching','candidate','approved','building','live','evaluating','stopped']);
const distributionState = z.enum(['idea','ready','published','observed','abandoned']);
const objective = z.enum(['gsc_clicks','organic_sessions','referral_sessions','engaged_sessions','returning_users']);
const baseline = z.object({
  start: day, end: day,
  completeness: z.enum(['complete','partial','missing']),
  value: z.number().min(0).nullable(),
  source: z.string().trim().max(400)
}).strict().superRefine((v,ctx)=>{
  if(v.start>v.end)ctx.addIssue({code:'custom',message:'Baseline end precedes start'});
  if(v.completeness==='missing'&&v.value!==null)ctx.addIssue({code:'custom',message:'Missing baseline must use null, not zero'});
  if(v.completeness==='complete'&&v.value===null)ctx.addIssue({code:'custom',message:'Complete baseline needs a measured value'});
});
const sourceObservation=z.object({url,observedAt:timestamp,finding:text}).strict();
const approval=z.object({approvedBy:text,approvedAt:timestamp,decisionReason:text}).strict();
const launchProof=z.object({
  productionUrl:url,sourceCommitSha:z.string().regex(/^[a-f0-9]{7,40}$/i),
  verifiedAt:timestamp,method:z.enum(['provider_deployment','http_readback']),
  detail:text
}).strict();
const measurement=z.object({
  metric:objective, start:day,end:day,completeness:z.enum(['complete','partial','missing']),
  value:z.number().min(0).nullable(),sourceUrl:url,recordedAt:timestamp,
  note:z.string().trim().max(1200).default('')
}).strict().superRefine((v,ctx)=>{
  if(v.start>v.end)ctx.addIssue({code:'custom',message:'Measurement end precedes start'});
  if(v.completeness==='missing'&&v.value!==null)ctx.addIssue({code:'custom',message:'Missing measurement must use null'});
  if(v.completeness==='complete'&&v.value===null)ctx.addIssue({code:'custom',message:'Complete measurement needs an observed value'});
});
const publishReceipt=z.object({platformPostUrl:url,publishedAt:timestamp,externalId:text}).strict();
const distributionMetrics=z.object({
  impressions:z.number().int().min(0).nullable(),
  outboundClicks:z.number().int().min(0).nullable(),
  referralSessions:z.number().int().min(0).nullable(),
  recordedAt:timestamp,sourceUrl:url
}).strict().refine(v=>[v.impressions,v.outboundClicks,v.referralSessions].some(n=>n!==null),{
  message:'Observed results require a real measured metric; unknown fields must be null'
});

export const growthInitiativeCreateShape={
  id:id.optional(),siteId:id,dedupeKey:text,title:z.string().trim().min(1).max(200),
  hypothesis:text,audience:text,userJob:text,program:z.enum(['search_recovery','organic_product','distribution','retention']),
  objectiveMetric:objective,assetUrl:url.optional(),sourceObservations:z.array(sourceObservation).min(1).max(12),
  baseline,plannedReviewDays:z.array(z.number().int().min(1).max(120)).min(1).max(5).default([14,28]),
  ownerRole:text,rollback:text,falsification:text,guardrails:z.array(text).max(20).default([]),
  directionId:id.optional(),status:z.enum(['researching','candidate']).default('candidate')
};
const createSchema=z.object(growthInitiativeCreateShape).strict();
export const growthInitiativeGetShape={id};
export const growthInitiativeListShape={siteId:id.optional(),status:initiativeStatus.optional(),limit:z.number().int().min(1).max(100).default(50)};
export const growthInitiativeUpdateShape={
  id,expectedRevision:z.number().int().positive(),
  status:initiativeStatus.optional(),assetUrl:url.optional(),
  taskIds:z.array(id).max(20).optional(),
  approval:approval.optional(),launchProof:launchProof.optional(),appendMeasurement:measurement.optional(),
  decision:text.optional(),nextReviewAt:timestamp.nullable().optional(),actor:text
};
const updateSchema=z.object(growthInitiativeUpdateShape).strict();

export const distributionExperimentCreateShape={
  id:id.optional(),initiativeId:id,siteId:id,dedupeKey:text,
  channel:z.enum(['x','threads','youtube_shorts','github','other']),
  accountRef:text.optional(),sourceAssetRef:text,targetUrl:url,
  utmCampaign:z.string().regex(/^[a-z0-9_-]{3,100}$/),
  creativeVariant:text,guardrails:z.array(text).max(12).default([])
};
const distributionCreateSchema=z.object(distributionExperimentCreateShape).strict();
export const distributionExperimentGetShape={id};
export const distributionExperimentListShape={
  siteId:id.optional(),initiativeId:id.optional(),state:distributionState.optional(),
  limit:z.number().int().min(1).max(100).default(50)
};
export const distributionExperimentUpdateShape={
  id,expectedRevision:z.number().int().positive(),state:distributionState.optional(),
  publishReceipt:publishReceipt.optional(),metrics:distributionMetrics.optional(),
  note:z.string().trim().max(1200).optional(),actor:text
};
const distributionUpdateSchema=z.object(distributionExperimentUpdateShape).strict();

type Initiative = z.infer<typeof createSchema>&{
  id:string; revision:number; status:z.infer<typeof initiativeStatus>;
  assetUrl?:string;taskIds:string[];approval:null|z.infer<typeof approval>;
  launchProof:null|z.infer<typeof launchProof>;
  measurements:z.infer<typeof measurement>[];
  decision:string;nextReviewAt:string|null;createdAt:string;updatedAt:string;
};
type Experiment = z.infer<typeof distributionCreateSchema>&{
  id:string;revision:number;state:z.infer<typeof distributionState>;
  publishReceipt:null|z.infer<typeof publishReceipt>;metrics:null|z.infer<typeof distributionMetrics>;
  note:string;createdAt:string;updatedAt:string;
};
const collectionI='growthInitiatives',collectionD='distributionExperiments';
const iso=()=>new Date().toISOString();
const decoded=(doc:any)=>Object.fromEntries(Object.entries(doc.fields??{}).map(([k,v])=>[k,value(v)])) as any;

async function readDocument(collection:string,key:string){
  try{return await firestore('/'+collection+'/'+encodeURIComponent(key))}
  catch(e){if(e instanceof FirestoreError&&e.status===404)return null;throw e}
}
async function bySite(collection:string,siteId:string,max=500){
  const query={structuredQuery:{
    from:[{collectionId:collection}],
    where:{fieldFilter:{field:{fieldPath:'siteId'},op:'EQUAL',value:field(siteId)}},
    limit:max
  }};
  const rows=await firestore(':runQuery',{method:'POST',body:JSON.stringify(query)});
  return (Array.isArray(rows)?rows:[]).filter((r:any)=>r.document).map((r:any)=>decoded(r.document));
}
async function listRecords(collection:string,siteId:string|undefined,limit:number){
  if(siteId)return bySite(collection,siteId,500);
  let next:string|undefined,items:any[]=[];
  do{
    const qs=new URLSearchParams({pageSize:'100'});
    if(next)qs.set('pageToken',next);
    const page=await firestore('/'+collection+'?'+qs.toString());
    items.push(...(page.documents??[]).map(decoded));
    next=page.nextPageToken;
    if(items.length>=500&&next)throw new Error('Growth portfolio exceeds 500 records; use siteId-scoped list');
  }while(next);
  return items;
}
async function activeSite(siteId:string){
  const site=await siteRegistryGet({id:siteId});
  if(site.status!=='active')throw new Error('Growth initiatives require an active managed site');
  return site;
}
function belongsToSite(assetUrl:string,productionUrl:string){
  return new URL(assetUrl).origin===new URL(productionUrl).origin;
}
async function write(collection:string,record:any,previous:any|null,verb:string){
  const runIds=await auditWriteBatch(verb,record.id,[{
    data:{__write:{collection,id:record.id,fields:record}},previous
  }]);
  return {...record,runId:runIds[0]};
}
const transitions:Record<string,string[]>={
  researching:['candidate','stopped'],candidate:['approved','stopped'],
  approved:['building','stopped'],building:['live','stopped'],
  live:['evaluating','stopped'],evaluating:['live','stopped'],stopped:[]
};
const distTransitions:Record<string,string[]>={
  idea:['ready','abandoned'],ready:['published','abandoned'],
  published:['observed','abandoned'],observed:['abandoned'],abandoned:[]
};

export async function growthInitiativeCreate(input:unknown){
  const args=createSchema.parse(input);const site=await activeSite(args.siteId);
  if(args.assetUrl&&!belongsToSite(args.assetUrl,site.productionUrl))throw new Error('Asset URL must belong to the registered site origin');
  const existing=await bySite(collectionI,args.siteId);
  const duplicate=existing.find((x:Initiative)=>x.dedupeKey===args.dedupeKey);
  if(duplicate)throw new Error('Growth initiative dedupeKey already exists: '+duplicate.id);
  const itemId=args.id??randomUUID();
  if(await readDocument(collectionI,itemId))throw new Error('Growth initiative ID already exists');
  const t=iso();const record:Initiative={
    ...args,id:itemId,revision:1,taskIds:[],approval:null,launchProof:null,
    measurements:[],decision:'',nextReviewAt:null,createdAt:t,updatedAt:t
  };
  return write(collectionI,record,null,'growth_initiative_create');
}
export async function growthInitiativeGet(input:unknown){
  const args=z.object(growthInitiativeGetShape).strict().parse(input);
  const doc=await readDocument(collectionI,args.id);
  if(!doc)throw new Error('Growth initiative not found');
  return decoded(doc) as Initiative;
}
export async function growthInitiativeList(input:unknown={}){
  const args=z.object(growthInitiativeListShape).strict().parse(input);
  if(args.siteId)await activeSite(args.siteId);
  const items=(await listRecords(collectionI,args.siteId,args.limit) as Initiative[])
    .filter(r=>!args.status||r.status===args.status)
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,args.limit);
  return {items};
}
export async function growthInitiativeUpdate(input:unknown){
  const args=updateSchema.parse(input),previous=await readDocument(collectionI,args.id);
  if(!previous)throw new Error('Growth initiative not found');
  const old=decoded(previous) as Initiative;
  if(old.revision!==args.expectedRevision)throw new Error('Revision conflict: re-read Growth Initiative');
  const site=await activeSite(old.siteId);
  const nextStatus=args.status??old.status;
  if(args.status&&args.status!==old.status&&!transitions[old.status]?.includes(args.status))
    throw new Error('Invalid Growth Initiative status transition');
  if(args.assetUrl&&!belongsToSite(args.assetUrl,site.productionUrl))throw new Error('Asset URL must belong to the site');
  const proof=args.launchProof??old.launchProof;
  const target=args.assetUrl??old.assetUrl;
  if(proof&&(!target||new URL(proof.productionUrl).origin!==new URL(target).origin))
    throw new Error('Publication proof must match site asset origin');
  if(['live','evaluating'].includes(nextStatus)&&(!proof||!target))
    throw new Error('Live initiatives require actual production proof and site asset URL');
  if(nextStatus==='approved'&&!(args.approval??old.approval))
    throw new Error('Approval requires recorded owner decision');
  if(args.appendMeasurement&&nextStatus!=='evaluating'&&nextStatus!=='live')
    throw new Error('Measurement may be recorded only after a verified live initiative');
  const {id:_id,expectedRevision:_revision,appendMeasurement,...patch}=args;
  const t=iso(),record:Initiative={
    ...old,...patch,status:nextStatus,revision:old.revision+1,updatedAt:t,
    measurements:args.appendMeasurement?[...(old.measurements??[]),args.appendMeasurement].slice(-40):old.measurements??[]
  };
  if(nextStatus==='live'&&old.status!=='live'&&record.nextReviewAt===null&&proof)
    record.nextReviewAt=new Date(Date.parse(proof.verifiedAt)+Math.min(...record.plannedReviewDays)*86400000).toISOString();
  return write(collectionI,record,previous,'growth_initiative_update');
}
export async function distributionExperimentCreate(input:unknown){
  const args=distributionCreateSchema.parse(input),site=await activeSite(args.siteId);
  const initiative=await growthInitiativeGet({id:args.initiativeId});
  if(initiative.siteId!==args.siteId)throw new Error('Cross-site experiment attribution is forbidden');
  if(!belongsToSite(args.targetUrl,site.productionUrl))throw new Error('Campaign target URL must belong to registered site');
  const existing=await bySite(collectionD,args.siteId);
  if(existing.some((r:Experiment)=>r.dedupeKey===args.dedupeKey))
    throw new Error('Distribution experiment dedupeKey already exists');
  const itemId=args.id??randomUUID();
  if(await readDocument(collectionD,itemId))throw new Error('Distribution experiment ID exists');
  const t=iso(),record:Experiment={...args,id:itemId,revision:1,state:'idea',publishReceipt:null,metrics:null,note:'',createdAt:t,updatedAt:t};
  return write(collectionD,record,null,'distribution_experiment_create');
}
export async function distributionExperimentGet(input:unknown){
  const args=z.object(distributionExperimentGetShape).strict().parse(input);
  const doc=await readDocument(collectionD,args.id);
  if(!doc)throw new Error('Distribution experiment not found');
  return decoded(doc) as Experiment;
}
export async function distributionExperimentList(input:unknown={}){
  const args=z.object(distributionExperimentListShape).strict().parse(input);
  if(args.siteId)await activeSite(args.siteId);
  const items=(await listRecords(collectionD,args.siteId,args.limit) as Experiment[])
    .filter(r=>(!args.initiativeId||r.initiativeId===args.initiativeId)&&(!args.state||r.state===args.state))
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,args.limit);
  return {items};
}
export async function distributionExperimentUpdate(input:unknown){
  const args=distributionUpdateSchema.parse(input),previous=await readDocument(collectionD,args.id);
  if(!previous)throw new Error('Distribution experiment not found');
  const old=decoded(previous) as Experiment;
  if(old.revision!==args.expectedRevision)throw new Error('Revision conflict: re-read Distribution Experiment');
  const initiative=await growthInitiativeGet({id:old.initiativeId});
  if(initiative.siteId!==old.siteId)throw new Error('Cross-site experiment attribution is forbidden');
  const nextState=args.state??old.state;
  if(args.state&&args.state!==old.state&&!distTransitions[old.state]?.includes(args.state))
    throw new Error('Invalid distribution experiment state transition');
  if(['ready','published','observed'].includes(nextState)&&!['live','evaluating'].includes(initiative.status))
    throw new Error('Distribution readiness requires an actually verified live first-party asset');
  const receipt=args.publishReceipt??old.publishReceipt;
  if(['published','observed'].includes(nextState)&&!receipt)
    throw new Error('Published experiment requires native platform post URL, ID and timestamp');
  if(nextState==='observed'&&!(args.metrics??old.metrics))
    throw new Error('Observed experiment requires measured metrics with an evidence URL');
  if(args.publishReceipt&&nextState!=='published')
    throw new Error('Publishing receipt is only accepted when transitioning to published');
  if(args.metrics&&nextState!=='observed')
    throw new Error('Distribution metrics are only accepted when transitioning to observed');
  const {id:_id,expectedRevision:_revision,...patch}=args;
  const record:Experiment={...old,...patch,state:nextState,revision:old.revision+1,updatedAt:iso()};
  return write(collectionD,record,previous,'distribution_experiment_update');
}
