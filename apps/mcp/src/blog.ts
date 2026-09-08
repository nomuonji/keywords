import { blogCommands } from '@keywords/commands/blog';
import { discoveryCommands } from '@keywords/commands/discovery';
import type { CommandContext } from '@keywords/domain';
const string={type:'string'},object={type:'object',additionalProperties:true};
const definitions:Array<[string,string,Record<string,unknown>,string[]]>=[
 ['contract','Read exact JSON schemas for Blog snapshots, evidence briefs and receipts before writing them.',{},[]],
 ['context','Read Blog binding, editorial briefs, handoffs and observation deadlines.',{},[]],
 ['importContext','Refresh an already human-confirmed Blog site binding; local builds never imply publication.',{snapshot:object},['snapshot']],
 ['prepare','Attach factual/value evidence to a plan before human approval. Changes invalidate approval.',{pageId:string,brief:object},['pageId','brief']],
 ['export','Export a current human-approved plan with expected source hashes and evidence; never publishes.',{pageId:string},['pageId']],
 ['get','Read live handoff validity before local work; stale approvals are invalid.',{handoffId:string},['handoffId']],
 ['receipt','Record idempotent Blog verification, publication evidence or outcome; guarded transitions.',{receipt:object},['receipt']],
 ['capture','Capture settled query-by-page GSC history scoped to the bound origin.',{startDate:string,endDate:string,siteUrl:string,searchType:string},['startDate','endDate','siteUrl']],
 ['evaluate','Compare matching before/after publication windows; small samples are inconclusive.',{handoffId:string,baselineId:string,followupId:string},['handoffId','baselineId','followupId']],
 ['expand','Expand a job seed or external observation through related searches/PAA; budget/lease/depth limited.',{jobId:string,seed:string,parentId:string,idempotencyKey:string},['jobId']],
 ['observations','Read raw discovered phrases and their source/parent lineage.',{jobId:string},['jobId']]
 ,['observe','Persist an exact raw phrase from existing project source evidence; audience expressions are not search demand.',{jobId:string,sourceId:string,rawPhrase:string,parentId:string},['jobId','sourceId','rawPhrase']]
];
export const blogTools=definitions.map(([name,description,properties,required])=>({name:`blog_${name}`,description,inputSchema:{type:'object' as const,properties:{projectId:string,...properties},required:['projectId',...required]}}));
export const isBlogTool=(name:string)=>blogTools.some(t=>t.name===name);
export async function callBlogTool(name:string,args:any,ctx:CommandContext){
 const op=name.slice(5); if(!isBlogTool(name))throw new Error('Unknown Blog tool');
 if(op==='expand')return discoveryCommands.expand(ctx,args);
 if(op==='observations')return discoveryCommands.observations(ctx,args);
 if(op==='observe')return discoveryCommands.observe(ctx,args);
 return (blogCommands as any)[op](ctx,args);
}
