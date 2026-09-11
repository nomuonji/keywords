import { blogCommands } from '@keywords/commands/blog';
import { discoveryCommands } from '@keywords/commands/discovery';
import { headlessCommands } from '@keywords/commands/headless';
import type { CommandContext } from '@keywords/domain';
const string={type:'string'},object={type:'object',additionalProperties:true};
const boolean={type:'boolean'},stringArray={type:'array',items:{type:'string'}};
const definitions:Array<[string,string,Record<string,unknown>,string[]]>=[
 ['contract','Read exact JSON schemas for Blog snapshots, evidence briefs and receipts before writing them.',{},[]],
 ['context','Read Blog binding, editorial briefs, handoffs and observation deadlines.',{},[]],
 ['importContext','Refresh an already human-confirmed Blog site binding; local builds never imply publication.',{snapshot:object},['snapshot']],
 ['prepare','Attach factual/value evidence to a plan before approval. Changes invalidate approval.',{pageId:string,brief:object},['pageId','brief']],
 ['export','Export a current human-approved plan with expected source hashes and evidence; never publishes.',{pageId:string},['pageId']],
 ['get','Read live handoff validity before local work; stale approvals are invalid.',{handoffId:string},['handoffId']],
 ['receipt','Record idempotent Blog verification, publication evidence or outcome; guarded transitions.',{receipt:object},['receipt']],
 ['verifyPublished','Directly verify target URLs from Keywords after Git delivery and record the publication/observation deadline; no Blog-side response is required.',{handoffId:string,source:string},['handoffId']],
 ['capture','Capture settled query-by-page GSC history scoped to the bound origin.',{startDate:string,endDate:string,siteUrl:string,searchType:string},['startDate','endDate','siteUrl']],
 ['evaluate','Compare matching before/after publication windows; small samples are inconclusive.',{handoffId:string,baselineId:string,followupId:string},['handoffId','baselineId','followupId']],
 ['expand','Expand a job seed or external observation through related searches/PAA; budget/lease/depth limited.',{jobId:string,seed:string,parentId:string,idempotencyKey:string},['jobId']],
 ['observations','Read raw discovered phrases and their source/parent lineage.',{jobId:string},['jobId']],
 ['observe','Persist an exact raw phrase from existing project source evidence; audience expressions are not search demand.',{jobId:string,sourceId:string,rawPhrase:string,parentId:string},['jobId','sourceId','rawPhrase']],
 ['writeDraft','Atomically write the real article file under KEYWORDS_BLOG_ROOT and persist an artifact manifest. Use this after blog_prepare; a new article is blocked unless its primary keyword has persisted search volume, competition, demand evidence, and a selection rationale. Revisions of an existing artifact reuse its original gate.',{operationId:string,pageId:string,content:string,artifactPath:string,articleId:string,sourceIds:stringArray,buildCommand:string},['operationId','pageId','content']],
 ['validateDraft','Independently validate the saved article against stored sources and run the site build. Results are cached by content/source/build revision key.',{operationId:string,articleId:string,buildCommand:string,force:boolean},['operationId']],
 ['artifactContext','Read persisted article artifacts, hashes, validation failures and build status for resume without private reasoning.',{operationId:string,pageId:string},[]]
];
export const blogTools=definitions.map(([name,description,properties,required])=>({name:`blog_${name}`,description,inputSchema:{type:'object' as const,properties:{projectId:string,...properties},required:['projectId',...required]}}));
export const isBlogTool=(name:string)=>blogTools.some(t=>t.name===name);
export async function callBlogTool(name:string,args:any,ctx:CommandContext){
 const op=name.slice(5); if(!isBlogTool(name))throw new Error('Unknown Blog tool');
 if(op==='expand')return discoveryCommands.expand(ctx,args);
 if(op==='observations')return discoveryCommands.observations(ctx,args);
 if(op==='observe')return discoveryCommands.observe(ctx,args);
 if(op==='writeDraft')return headlessCommands.writeDraft(ctx,args);
 if(op==='validateDraft')return headlessCommands.validateDraft(ctx,args);
 if(op==='artifactContext')return headlessCommands.context(args);
 return (blogCommands as any)[op](ctx,args);
}
