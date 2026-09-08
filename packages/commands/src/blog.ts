import { createHash, randomUUID } from 'node:crypto';
import { getDatabase } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { searchConsoleQuery } from '@keywords/research';
import { blogContract, briefSchema, receiptSchema, snapshotSchema, type BlogSnapshot } from './blog-contract.js';
import { isBudgetedCommand } from './budget.js';

const { sqlite } = getDatabase();
const now = () => new Date().toISOString();
export const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const one = (sql: string, ...args: any[]): any => sqlite.prepare(sql).get(...args);
const rows = (sql: string, ...args: any[]): any[] => sqlite.prepare(sql).all(...args);
const run = (sql: string, ...args: any[]) => sqlite.prepare(sql).run(...args);
const parse = (value: string) => JSON.parse(value);
function required(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }
function project(id: string) { const p = one('SELECT * FROM projects WHERE id=?', id); required(p, 'Project not found'); return p; }
function binding(id: string) { const b = one('SELECT * FROM blog_bindings WHERE project_id=?', id); required(b, 'Import and confirm a Blog site context first'); return b; }
function sameOrigin(url: string, origin: string) { required(new URL(url).origin === origin, 'Cross-origin URL rejected'); }
function fresh(value: string, days = 7) {
 const age = Date.now() - Date.parse(value); required(Number.isFinite(age) && age >= -300000 && age <= days * 86400000, 'Evidence is stale or future-dated; refresh first');
}
function source(id: string, projectId: string) {
 const s = one('SELECT * FROM sources WHERE id=? AND project_id=?', id, projectId); required(s, 'Evidence source not in project'); return s;
}
function pageVersion(pageId: string) {
 const p = one('SELECT * FROM pages WHERE id=?', pageId);
 return fingerprint({page:p, targets:rows('SELECT keyword_id,role FROM page_keywords WHERE page_id=? ORDER BY keyword_id',pageId), brief:one('SELECT packet_hash FROM blog_briefs WHERE page_id=?',pageId)});
}

// Reserve work-session budget before mutations/external reads, also for CLI and HTTP.
async function audited<T>(ctx: CommandContext, projectId: string, name: string, fn: () => T | Promise<T>): Promise<T> {
 project(projectId);
 const runId = randomUUID(); let sessionId = ctx.workSessionId ?? null;
 sqlite.transaction(() => {
  const session = sessionId ? one('SELECT * FROM work_sessions WHERE id=? AND project_id=?', sessionId,projectId)
    : ctx.actor !== 'human' ? one("SELECT * FROM work_sessions WHERE project_id=? AND status NOT IN ('completed','cancelled') ORDER BY started_at DESC LIMIT 1",projectId) : null;
  if (sessionId) required(session,'Session not in project');
  if (session) {
   required(session.status==='running','Work session is paused or finished');
   if(ctx.actor==='agent' && session.actor_id) required(session.actor_id===ctx.actorId,'Work session belongs to another agent');
   sessionId=session.id;
   const used=rows('SELECT command FROM runs WHERE work_session_id=?',sessionId).filter(r=>isBudgetedCommand(r.command)||r.command.startsWith('blog.')).length;
   required(used<session.max_actions,'Work session action budget exhausted');
  }
  run('INSERT INTO runs(id,project_id,work_session_id,actor,actor_id,command,status,created_at) VALUES(?,?,?,?,?,?,?,?)',runId,projectId,sessionId,ctx.actor,ctx.actorId??null,name,'running',now());
 }).immediate();
 try { const result=await fn(); run("UPDATE runs SET status='succeeded',output_json=? WHERE id=?",JSON.stringify({ok:true}),runId); return result; }
 catch(error) { run("UPDATE runs SET status='failed',error=? WHERE id=?",'Command rejected or failed; inspect validated inputs and provider configuration',runId); throw error; }
}

export function assertBlogPlanReady(projectId: string, pageId: string) {
 if(!one('SELECT project_id FROM blog_bindings WHERE project_id=?',projectId)) return;
 const b=one('SELECT * FROM blog_briefs WHERE project_id=? AND page_id=?',projectId,pageId);
 required(b,'Blog delivery requires a value/evidence brief before page approval');
 const packet=briefSchema.parse(parse(b.packet_json));
 required(!packet.unresolved_questions.length,'Resolve the brief questions before approval');
 required(packet.review_due_at>=now().slice(0,10),'Brief review is overdue');
 for(const id of new Set([...packet.value_source_ids,...packet.demand_source_ids,...packet.serp_comparison.map(x=>x.source_id),...packet.claim_source_map.map(x=>x.source_id)])) source(id,projectId);
 for(const id of packet.demand_source_ids) fresh(source(id,projectId).created_at,30);
}

export function blogNextActions(projectId: string) {
 const handoffs=rows('SELECT id,status,next_observation_at FROM blog_handoffs WHERE project_id=?',projectId);
 return handoffs.filter(h=>h.status==='blocked'||(h.next_observation_at&&h.next_observation_at<=now())).map(h=>({
  kind:h.status==='blocked'?'blog_blocked':'blog_observation_due',rank:4.5,title:h.status==='blocked'?'Resolve Blog delivery blocker':'Observe published Blog change',
  reason:h.status==='blocked'?'Blog reported a blocker; inspect receipt before more content.':`Observation due: ${h.next_observation_at}`,relatedType:'blog_handoff',relatedId:h.id
 }));
}

export const blogCommands = {
 contract:async()=>blogContract,
 context: async (_ctx: CommandContext, input: {projectId:string}) => {
  project(input.projectId); const b=one('SELECT * FROM blog_bindings WHERE project_id=?',input.projectId);
  return {binding:b?{siteId:b.blog_site_id,origin:b.origin,observedAt:b.observed_at,coverage:parse(b.snapshot_json).coverage}:null,
   handoffs:rows('SELECT id,page_id,status,published_at,next_observation_at,created_at FROM blog_handoffs WHERE project_id=? ORDER BY created_at DESC',input.projectId),
   briefs:rows('SELECT page_id,packet_json,packet_hash,created_at FROM blog_briefs WHERE project_id=?',input.projectId).map(b=>({...b,packet:parse(b.packet_json),packet_json:undefined})),
   captures:rows('SELECT id,start_date,end_date,context_key,created_at FROM blog_query_page_captures WHERE project_id=? ORDER BY end_date DESC LIMIT 30',input.projectId),
   next:blogNextActions(input.projectId)};
 },
 importContext: async (ctx:CommandContext,input:{projectId:string;snapshot:unknown}) => audited(ctx,input.projectId,'blog.import_context',()=>sqlite.transaction(()=>{
  const s=snapshotSchema.parse(input.snapshot), p=project(input.projectId), origin=new URL(s.canonical_origin).origin;
  required(origin===s.canonical_origin,'Canonical origin must have no path or trailing slash');
  const projectHost=p.domain?new URL(p.domain.includes('://')?p.domain:`https://${p.domain}`).hostname:null;
  required(projectHost===new URL(origin).hostname,'Project domain must match the Blog origin');
  required(p.language===s.language&&p.country===s.country,'Language/country mismatch'); fresh(s.observed_at);
  const old=one('SELECT * FROM blog_bindings WHERE project_id=?',input.projectId);
  if(!old) required(ctx.actor==='human','Initial site binding requires human confirmation');
  if(old) {required(old.blog_site_id===s.blog_site_id&&old.origin===origin,'Binding cannot silently change'); required(Date.parse(s.observed_at)>=Date.parse(old.observed_at),'Older snapshot rejected');}
  for(const item of s.sources) sameOrigin(item.expected_url,origin);
  for(const item of s.pages) sameOrigin(item.local_build_url,origin);
  const hash=fingerprint(s); if(old?.snapshot_hash===hash) return {unchanged:true};
  for(const url of new Set([...s.sources.map(x=>x.expected_url),...s.pages.map(x=>x.local_build_url)])) {
   const src=s.sources.find(x=>x.expected_url===url), build=s.pages.find(x=>x.local_build_url===url);
   const existing=one('SELECT * FROM pages WHERE project_id=? AND url=?',input.projectId,url);
   if(!existing) run('INSERT INTO pages(id,project_id,title,slug,kind,status,url,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',randomUUID(),input.projectId,src?.title||build?.title||url,`local-${fingerprint(url).slice(0,24)}`,'existing','local',url,'blog_local',now(),now());
   else if(existing.source==='blog_local')run('UPDATE pages SET title=?,updated_at=? WHERE id=?',src?.title||build?.title||url,now(),existing.id);
   // Never overwrite an approved plan or infer live publication from local builds.
  }
  run('INSERT INTO blog_bindings(project_id,blog_site_id,origin,language,country,snapshot_json,snapshot_hash,observed_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,snapshot_hash=excluded.snapshot_hash,observed_at=excluded.observed_at',input.projectId,s.blog_site_id,origin,s.language,s.country,JSON.stringify(s),hash,s.observed_at);
  return {unchanged:false,siteId:s.blog_site_id,coverage:s.coverage};
 }).immediate()),
 prepare: async(ctx:CommandContext,input:{projectId:string;pageId:string;brief:unknown})=>audited(ctx,input.projectId,'blog.prepare',()=>sqlite.transaction(()=>{
  binding(input.projectId);const p=one('SELECT * FROM pages WHERE id=? AND project_id=?',input.pageId,input.projectId); required(p&&p.source==='workspace','Workspace page plan required');
  required(!one("SELECT id FROM blog_handoffs WHERE page_id=? AND status NOT IN ('evaluated','blocked')",p.id),'Existing handoff is still active');
  const brief=briefSchema.parse(input.brief);
  for(const id of new Set([...brief.value_source_ids,...brief.demand_source_ids,...brief.serp_comparison.map(x=>x.source_id),...brief.claim_source_map.map(x=>x.source_id)])) source(id,input.projectId);
  for(const sourceId of new Set([...brief.value_source_ids,...brief.demand_source_ids,...brief.serp_comparison.map(x=>x.source_id),...brief.claim_source_map.map(x=>x.source_id)]))
    run('INSERT OR IGNORE INTO source_links(id,project_id,source_id,target_type,target_id,kind,created_at) VALUES(?,?,?,?,?,?,?)',randomUUID(),input.projectId,sourceId,'page',p.id,'blog_brief',now());
  for(const id of brief.demand_source_ids) {const s=source(id,input.projectId); required(['serp','google_ads','gsc_snapshot','search_console','search_observation'].includes(s.type),'Demand needs a search observation, not an audience-expression source'); fresh(s.created_at,30);}
  for(const comparison of brief.serp_comparison) required(['serp','web'].includes(source(comparison.source_id,input.projectId).type),'SERP comparison needs SERP/page evidence');
  run('INSERT INTO blog_briefs(page_id,project_id,packet_json,packet_hash,created_at) VALUES(?,?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET packet_json=excluded.packet_json,packet_hash=excluded.packet_hash,created_at=excluded.created_at',p.id,input.projectId,JSON.stringify(brief),fingerprint(brief),now());
  run("UPDATE pages SET status='proposed',updated_at=? WHERE id=?",now(),p.id);
  return {pageId:p.id,status:'proposed',requiresHumanReview:true};
 }).immediate()),
 export: async(ctx:CommandContext,input:{projectId:string;pageId:string})=>audited(ctx,input.projectId,'blog.export',()=>sqlite.transaction(()=>{
  const b=binding(input.projectId); fresh(b.observed_at); const snap:BlogSnapshot=parse(b.snapshot_json);
  const p=one('SELECT * FROM pages WHERE id=? AND project_id=?',input.pageId,input.projectId); required(p?.status==='approved','Page must be approved by a human');
  assertBlogPlanReady(input.projectId,p.id);
  const approval=one("SELECT * FROM decisions WHERE project_id=? AND target_id=? AND action='page.review' ORDER BY created_at DESC,rowid DESC LIMIT 1",input.projectId,p.id);
  required(approval?.actor==='human'&&approval.verdict==='approved','Latest page decision must be human approval');
  const version=pageVersion(p.id), old=one('SELECT * FROM blog_handoffs WHERE page_id=? AND version_hash=?',p.id,version); if(old)return parse(old.payload_json);
  required(!one("SELECT id FROM blog_handoffs WHERE page_id=? AND status NOT IN ('evaluated','blocked')",p.id),'Previous handoff still active');
  const brief=briefSchema.parse(parse(one('SELECT packet_json FROM blog_briefs WHERE page_id=?',p.id).packet_json));
  const target=p.target_page_id?one('SELECT * FROM pages WHERE id=? AND project_id=?',p.target_page_id,input.projectId):null;
  const action=p.plan_mode==='existing_page_improvement'?'substantial_revision':'new_article';
  if(action==='new_article') {
   required(snap.eligibility.new_content_allowed===true,'Site snapshot does not allow new content');
   required(snap.eligibility.clearance_gate==='listed_for_scoped_clearance','Site not cleared for new content');
   required(!one("SELECT id FROM blog_handoffs WHERE project_id=? AND status!='evaluated'",input.projectId),'Observe previous batch before more new content');
   const prior=rows('SELECT r.payload_json FROM blog_receipts r JOIN blog_handoffs h ON h.id=r.handoff_id WHERE h.project_id=? ORDER BY r.created_at DESC',input.projectId).map(r=>parse(r.payload_json)).filter(r=>r.outcome);
   required(!prior.length||prior[0].outcome.verdict==='improved','Previous outcome does not support expanding new content');
   if(prior.length)required(new Set(prior.filter(r=>r.outcome.verdict==='improved').map(r=>`${r.outcome.baseline_capture_id}:${r.outcome.followup_capture_id}`)).size>=2,'Two distinct successful observation comparisons required before expanding new content');
  } else required(target?.url,'Existing target URL required');
  const targetUrl=target?.url||`${b.origin}/${p.slug.replace(/^\/+|\/+$/g,'')}/`; sameOrigin(targetUrl,b.origin);
  const matches=snap.sources.filter(s=>s.expected_url===targetUrl);
  required(matches.length===(action==='new_article'?0:1),'Target source is missing, ambiguous or already exists');
  if(action==='new_article')required(!snap.pages.some(x=>x.local_build_url===targetUrl),'URL already present in local build');
  const targets=rows('SELECT k.id,k.text,pk.role FROM page_keywords pk JOIN keywords k ON k.id=pk.keyword_id WHERE pk.page_id=? ORDER BY k.id',p.id);
  required(targets.some(t=>t.role==='primary'),'Primary keyword required');
  required(brief.research.skills_used.includes(action==='new_article'?'niche-keyword-finder':'seo-report')||action!=='new_article'&&brief.research.skills_used.includes('niche-keyword-finder'),'Record actual required research skill before export');
  const payload={schema_version:1,handoff_id:randomUUID(),version_hash:version,project_id:input.projectId,blog_site_id:b.blog_site_id,plan_id:p.id,approval_ref:approval.id,created_at:now(),action,
   canonical_origin:b.origin,target_urls:[targetUrl],target_sources:matches.map(s=>({path:s.source_ref,sha256:s.source_sha256})),snapshot_hash:b.snapshot_hash,
   route_evidence:snap.route_evidence,brief,primary_query:targets.find(t=>t.role==='primary').text,target_queries:targets.map(t=>t.text),keyword_ids:targets.map(t=>t.id),cluster_id:p.cluster_id||p.id,
   publication_authorized:false};
  run('INSERT INTO blog_handoffs(id,project_id,page_id,version_hash,payload_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',payload.handoff_id,input.projectId,p.id,version,JSON.stringify(payload),'exported',now(),now());
  return payload;
 }).immediate()),
 get: async(_ctx:CommandContext,input:{projectId:string;handoffId:string})=>{
  const h=one('SELECT * FROM blog_handoffs WHERE id=? AND project_id=?',input.handoffId,input.projectId); required(h,'Handoff not found');
  const p=one('SELECT status FROM pages WHERE id=?',h.page_id);
  return {payload:parse(h.payload_json),status:h.status,valid:p?.status==='approved'&&h.version_hash===pageVersion(h.page_id),receipts:rows('SELECT payload_json FROM blog_receipts WHERE handoff_id=? ORDER BY created_at',h.id).map(r=>parse(r.payload_json))};
 },
 receipt: async(ctx:CommandContext,input:{projectId:string;receipt:unknown})=>audited(ctx,input.projectId,'blog.receipt',()=>sqlite.transaction(()=>{
  const r=receiptSchema.parse(input.receipt);const h=one('SELECT * FROM blog_handoffs WHERE id=? AND project_id=?',r.handoff_id,input.projectId);required(h,'Handoff not in project');
  const hash=fingerprint(r), old=one('SELECT * FROM blog_receipts WHERE event_id=?',r.event_id);
  if(old){required(old.payload_hash===hash&&old.handoff_id===h.id,'Event ID payload collision');return {status:h.status,duplicate:true};}
  required(r.version_hash===h.version_hash,'Receipt version mismatch');fresh(r.occurred_at,365);
  const payload=parse(h.payload_json);required(JSON.stringify([...r.final_urls].sort())===JSON.stringify([...payload.target_urls].sort()),'Receipt URLs differ from approved targets');
  const allowed:Record<string,string[]>={exported:['accepted','blocked'],accepted:['local_verified','blocked'],blocked:['accepted'],local_verified:['published','blocked'],published:['observing','evaluated','blocked'],observing:['observing','evaluated','blocked'],evaluated:['observing','evaluated']};
  required(allowed[h.status]?.includes(r.status),'Invalid receipt transition');
  if(r.status==='accepted')required(pageVersion(h.page_id)===h.version_hash,'Plan changed since export');
  if(r.status==='blocked')required(r.reason,'Blocker reason required');
  if(r.status==='local_verified')required(r.blog_item_id&&r.evidence_refs.length>=2,'Verified Blog item and quality/build evidence required');
  let publishedAt=h.published_at, due=h.next_observation_at;
  if(r.status==='published') {
   required(r.publication,'Publication checks required');fresh(r.publication.confirmed_at);
   required(r.final_urls.every(u=>r.publication!.checks.some(c=>c.url===u&&c.canonical===u)),'Final HTTP/canonical checks incomplete');
   publishedAt=r.publication.confirmed_at;due=new Date(Date.parse(publishedAt)+7*86400000).toISOString();
  }
  if(r.status==='observing'){required(publishedAt&&r.evidence_refs.length,'Publication and observation evidence required');due=new Date(Math.max(Date.now()+7*86400000,Date.parse(publishedAt)+28*86400000)).toISOString();}
  if(r.status==='evaluated') {
   required(publishedAt&&r.outcome,'Published outcome required');
   const evaluation=evaluateOutcome(input.projectId,h,r.outcome.baseline_capture_id,r.outcome.followup_capture_id);
   required(evaluation.verdict===r.outcome.verdict,`Evidence supports ${evaluation.verdict}, not requested verdict`);
   due=r.outcome.verdict==='inconclusive'?new Date(Date.now()+28*86400000).toISOString():null;
  }
  run('INSERT INTO blog_receipts(event_id,handoff_id,payload_hash,payload_json,created_at) VALUES(?,?,?,?,?)',r.event_id,h.id,hash,JSON.stringify(r),now());
  run('UPDATE blog_handoffs SET status=?,published_at=?,next_observation_at=?,updated_at=? WHERE id=?',r.status,publishedAt,due,now(),h.id);
  return {status:r.status,duplicate:false,nextObservationAt:due};
 }).immediate()),
 capture: async(ctx:CommandContext,input:{projectId:string;startDate:string;endDate:string;siteUrl:string;searchType?:string})=>audited(ctx,input.projectId,'blog.capture',async()=>{
  const b=binding(input.projectId);required(/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)&&/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)&&input.startDate<=input.endDate,'Valid ordered dates required');
  for(const date of [input.startDate,input.endDate])required(Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date,'Invalid calendar date');
  required(Date.parse(input.endDate)<Date.now()-3*86400000,'Use settled data at least three days old');
  const searchType=input.searchType||'web', filters=[{dimension:'page',operator:'includingRegex',expression:`^${b.origin.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}/`}];
  const resultRows:any[]=[];let complete=false;
  for(let start=0;start<100000;start+=25000){const result=await searchConsoleQuery({siteUrl:input.siteUrl,startDate:input.startDate,endDate:input.endDate,searchType,dimensions:['query','page'],rowLimit:25000,startRow:start,dimensionFilterGroups:[{groupType:'and',filters}]}); resultRows.push(...result.rows);if(result.rows.length<25000){complete=true;break;}}
  const context={siteUrl:input.siteUrl,searchType,origin:b.origin,dimensions:['query','page']}, key=fingerprint(context), id=randomUUID();
  const data={context,startDate:input.startDate,endDate:input.endDate,complete,rows:resultRows,observedAt:now(),limitations:['Search Console may omit anonymized and other rows.']};
  for(const row of resultRows){sameOrigin(row.keys[1],b.origin);required([row.clicks,row.impressions,row.ctr,row.position].every(Number.isFinite),'Invalid metric');}
  // Replace a period only after all requests succeed; preserve prior data on failure.
  sqlite.transaction(()=>{run('INSERT INTO blog_query_page_captures(id,project_id,context_key,start_date,end_date,payload_json,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id,context_key,start_date,end_date) DO UPDATE SET payload_json=excluded.payload_json,created_at=excluded.created_at',id,input.projectId,key,input.startDate,input.endDate,JSON.stringify(data),now());}).immediate();
  return {captureId:one('SELECT id FROM blog_query_page_captures WHERE project_id=? AND context_key=? AND start_date=? AND end_date=?',input.projectId,key,input.startDate,input.endDate).id,rows:resultRows.length,complete};
 }),
 evaluate:async(_ctx:CommandContext,input:{projectId:string;handoffId:string;baselineId:string;followupId:string})=>{
  const h=one('SELECT * FROM blog_handoffs WHERE id=? AND project_id=?',input.handoffId,input.projectId);required(h,'Handoff not found');return evaluateOutcome(input.projectId,h,input.baselineId,input.followupId);
 }
};

function evaluateOutcome(projectId:string,h:any,beforeId:string,afterId:string){
 required(h.published_at,'Publication must be confirmed first');
 const a=one('SELECT * FROM blog_query_page_captures WHERE id=? AND project_id=?',beforeId,projectId),b=one('SELECT * FROM blog_query_page_captures WHERE id=? AND project_id=?',afterId,projectId);
 required(a&&b&&a.context_key===b.context_key,'Comparable captures required');
 required(Date.parse(a.end_date)-Date.parse(a.start_date)===Date.parse(b.end_date)-Date.parse(b.start_date)&&a.end_date<b.start_date,'Equal nonoverlapping windows required');
 required(a.end_date<h.published_at.slice(0,10)&&b.start_date>h.published_at.slice(0,10),'Windows must be before/after publication');
 const payload=parse(h.payload_json), before=parse(a.payload_json),after=parse(b.payload_json);
 const normalize=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ');
 const queries=(payload.target_queries||[payload.primary_query]).map(normalize);
 const sum=(data:any)=>data.rows.filter((r:any)=>payload.target_urls.includes(r.keys[1])&&queries.includes(normalize(r.keys[0]))).reduce((s:any,r:any)=>({clicks:s.clicks+r.clicks,impressions:s.impressions+r.impressions}),{clicks:0,impressions:0});
 const x=sum(before),y=sum(after); const sufficient=before.complete&&after.complete&&x.impressions>=50&&y.impressions>=50;
 const verdict=!sufficient?'inconclusive':y.clicks>x.clicks?'improved':y.clicks<x.clicks?'regressed':'inconclusive';
 const otherLandingPages=[...new Set(after.rows.filter((r:any)=>queries.includes(normalize(r.keys[0]))&&!payload.target_urls.includes(r.keys[1])).map((r:any)=>r.keys[1]))];
 return {verdict,before:x,after:y,otherLandingPages,causalClaim:false,reason:sufficient?'Observed target-query clicks on target URLs; not causal proof.':'Insufficient or incomplete observations; do not scale.'};
}
