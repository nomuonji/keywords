import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { firestore, firestoreDocumentName, field, value, FirestoreError } from '../../db/src/firestore.js';
import { treasurySearch } from '../../keyword-treasury/src/index.js';
import { seoSourceGet } from './seo-source-pool.js';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const recordDeleteShape = {
  kind: z.enum(['keyword','idea','seo_source','seo_case']),
  id,
  expectedLabel: z.string().min(1).max(500),
  expectedRevision: z.number().int().min(0).optional()
};
export const treasuryPruneShape = {
  keepKeywords: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
  expectedDeleteCount: z.number().int().min(0).max(400).optional()
};
const schema: Record<string,[string,string]> = {
  keyword:['keywordTreasury','keyword'],idea:['ideaMemory','title'],
  seo_source:['seoSourceAccounts','label'],seo_case:['seoCaseSites','domain']
};
const decode = (doc:any):Record<string,any> => Object.fromEntries(Object.entries(doc.fields??{}).map(([k,v])=>[k,value(v)]));
const docName = (path:string) => firestoreDocumentName(path);
const norm = (word:string) => word.normalize('NFKC').trim();
async function read(path:string) {
  try {return await firestore('/'+path);}
  catch(e){if(e instanceof FirestoreError && e.status===404)return null;throw e;}
}
function error(message:string,status:number):never {const e = new Error(message) as Error&{status:number};e.status=status;throw e;}
function audit(kind:string, records:Array<{id:string;label:string}>) {
  const runId=randomUUID();
  return {runId,write:{update:{name:docName('runs/'+runId),fields:{
    command:field('record_delete'),kind:field(kind),records:field(records),
    createdAt:field(new Date().toISOString()),actor:field('owner_explicit_delete')
  }},currentDocument:{exists:false}}};
}
export async function recordDelete(input:unknown) {
  const args=z.object(recordDeleteShape).strict().parse(input);
  const [collection,key]=schema[args.kind],path=collection+'/'+args.id;
  if(args.kind==='keyword'&&!/^[a-f0-9]{32}$/.test(args.id))error('Invalid keyword ID',400);
  if(args.kind==='seo_case'&&!/^case_[a-f0-9]{24}$/.test(args.id))error('Invalid case ID',400);
  const doc=await read(path);
  let data=doc?decode(doc):null;
  if(args.kind==='seo_source'&&!data) {
    const found=await seoSourceGet({id:args.id,scanLimit:1}).catch((e:unknown)=>{
      if(e instanceof Error&&e.message==='SEO source not found')return null;throw e;
    });
    data=found?.source??null;
  }
  if(!data||data.deletedAt)error('Record not found',404);
  if(norm(String(data[key]??''))!==norm(args.expectedLabel))error('Record label has changed',409);
  if(args.expectedRevision!==undefined&&Number(data.revision??0)!==args.expectedRevision)error('Record revision has changed',409);
  if(args.kind==='keyword'){
    const linked=await treasurySearch({linkedToSite:true,limit:100});
    if(linked.nextPageToken||linked.truncated||linked.items.some(v=>v.id===args.id))error('Keyword link check failed or site links exist',409);
  }
  // A built-in source cannot be hard-deleted from source code. Its tombstone
  // suppresses the seed on subsequent reads; separate scan evidence is retained.
  const builtin=args.kind==='seo_source'&&(data.origin==='builtin'||args.id==='x_ezayan');
  const change=builtin?{
    update:{name:docName(path),fields:{id:field(args.id),label:field(data.label),
      origin:field('builtin'),deletedAt:field(new Date().toISOString()),
      revision:field(Number(data.revision??0)+1)}},
    currentDocument:doc?{updateTime:doc.updateTime}:{exists:false}
  }:{
    delete:docName(path),currentDocument:doc?{updateTime:doc.updateTime}:{exists:true}
  };
  const tracked=audit(args.kind,[{id:args.id,label:args.expectedLabel}]);
  await firestore(':commit',{method:'POST',body:JSON.stringify({writes:[change,tracked.write]})});
  return {deleted:true,id:args.id,kind:args.kind,runId:tracked.runId,
    preservedHistory:args.kind==='idea'?'ideaFeedback':args.kind==='seo_source'?'seoSourceScans':null};
}
export async function treasuryPrune(input:unknown) {
  const args=z.object(treasuryPruneShape).strict().parse(input);
  const keep=new Set(args.keepKeywords.map(norm));
  if(keep.size!==args.keepKeywords.length)error('Duplicate keep keyword',400);
  const all:Array<{id:string;keyword:string}>=[];
  let next:string|undefined, truncated=false;
  for(let page=0;page<20;page++){
    const r=await treasurySearch({limit:100,sortBy:'keyword',sortOrder:'asc',pageToken:next});
    all.push(...r.items.map(x=>({id:x.id,keyword:x.keyword})));
    truncated ||=r.truncated;next=r.nextPageToken??undefined;
    if(!next)break;
  }
  if(truncated||next)error('Treasury exceeds safe scan limit',409);
  for(const keyword of keep)if(!all.some(x=>norm(x.keyword)===keyword))error('Keep keyword missing: '+keyword,409);
  const remove=all.filter(x=>!keep.has(norm(x.keyword)));
  const preview={total:all.length,keep:all.filter(x=>keep.has(norm(x.keyword))),
    deleteCount:remove.length,toDelete:remove};
  if(args.expectedDeleteCount===undefined)return {deleted:false,preview};
  if(args.expectedDeleteCount!==remove.length)error('Treasury changed: preview again',409);
  if(remove.length>400)error('Bulk deletion limited to 400 records',400);
  const linked=await treasurySearch({linkedToSite:true,limit:100});
  if(linked.nextPageToken||linked.truncated)error('Cannot verify all keyword links',409);
  const removingIds=new Set(remove.map(x=>x.id));
  const affectedIds=[...new Set(linked.items.filter(x=>removingIds.has(x.id)).flatMap(x=>x.linkedSiteConceptIds))];
  const structures=await Promise.all(affectedIds.map(async structureId=>{
    const doc=await read('siteStructures/'+structureId);
    if(!doc)error('Linked site structure disappeared; reload',409);
    const old=decode(doc);
    const nodes=(old.nodes??[]).map((node:any)=>({
      ...node,
      keywordIds:(node.keywordIds??[]).filter((id:string)=>!removingIds.has(id)),
      keywordRoles:Object.fromEntries(Object.entries(node.keywordRoles??{}).filter(([id])=>!removingIds.has(id)))
    }));
    const updated={...old,nodes,revision:Number(old.revision??0)+1,updatedAt:new Date().toISOString()};
    return {update:{name:docName('siteStructures/'+structureId),fields:Object.fromEntries(Object.entries(updated).map(([key,item])=>[key,field(item)]))},currentDocument:{updateTime:doc.updateTime}};
  }));
  if(!remove.length)return {deleted:true,count:0,kept:preview.keep};
  const tracked=audit('keyword_prune',remove.map(v=>({id:v.id,label:v.keyword})));
  await firestore(':commit',{method:'POST',body:JSON.stringify({writes:[
    ...structures,
    ...remove.map(x=>({delete:docName('keywordTreasury/'+x.id),currentDocument:{exists:true}})),
    tracked.write
  ]})});
  return {deleted:true,count:remove.length,kept:preview.keep,detachedSiteStructures:affectedIds,runId:tracked.runId};
}
