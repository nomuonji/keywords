import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Always isolated: never migrate/write the user's workspace database in this test.
process.env.KEYWORDS_DB_PATH=join(mkdtempSync(join(tmpdir(),'keywords-blog-test-')),'test.sqlite');
const {commands}=await import('@keywords/commands');
const {blogCommands}=await import('@keywords/commands/blog');
const {planningCommands}=await import('@keywords/commands/planning');
const {workCommands}=await import('@keywords/commands/work');
const {discoveryCommands}=await import('@keywords/commands/discovery');
const {getDatabase}=await import('@keywords/db');
const {sqlite}=getDatabase();
const human={actor:'human' as const,actorId:'test-human'},agent={actor:'agent' as const,actorId:'test-agent'};
const p=await commands.project.create(human,{name:'Fixture Blog',domain:'example.com'});
const s={schema_version:1,kind:'blog_site_context',observed_at:new Date().toISOString(),blog_site_id:'fixture',canonical_origin:'https://example.com',language:'ja',country:'jp',mapping_sha256:'a'.repeat(64),route_evidence:[],
 eligibility:{remediation_status:'cleared',clearance_gate:'blocked_or_unapproved',new_content_allowed:false,reason:'fixture',quality_status:'not_evaluated',index_health:'not_evaluated'},
 sources:[{source_ref:'content/a.md',source_sha256:'b'.repeat(64),title:'Existing',expected_url:'https://example.com/a/',draft:false,declared_date:null,headings:['Question'],local_build_present:true}],pages:[],
 coverage:{source_count:1,local_build_page_count:0,unmapped_build_pages:0,sources_absent_from_build:0,duplicate_expected_urls:[],complete_site_coverage:false},warnings:[]};
await assert.rejects(()=>blogCommands.importContext(agent,{projectId:p.id,snapshot:s}),/human/);
await blogCommands.importContext(human,{projectId:p.id,snapshot:s});
assert.equal((await blogCommands.importContext(agent,{projectId:p.id,snapshot:s})).unchanged,true);
const target=sqlite.prepare('SELECT * FROM pages WHERE project_id=? AND url=?').get(p.id,'https://example.com/a/') as any;
assert.equal(target.status,'local');
await assert.rejects(()=>blogCommands.importContext(human,{projectId:p.id,snapshot:{...s,canonical_origin:'https://different.example'}}),/domain/);
await assert.rejects(()=>blogCommands.importContext(human,{projectId:p.id,snapshot:{...s,sources:[{...s.sources[0],source_ref:'../../secret'}]}}));
const keyword=await commands.keyword.create(agent,{projectId:p.id,text:'fixture query'});
const evidence=await commands.source.record(agent,{projectId:p.id,type:'serp',label:'Fixture search and page evidence',metadata:{result:{relatedSearches:['fixture query'],results:[{title:'Fixture',link:'https://example.org/article'}]}}});
const plan=await planningCommands.pagePlan(agent,{projectId:p.id,title:'Improve fixture',primaryKeywordId:keyword.id,planMode:'existing_page_improvement',targetPageId:target.id,sourceIds:[evidence.id],rationale:'Fixture'});
await assert.rejects(()=>planningCommands.pageReview(human,{projectId:p.id,pageId:plan.page.id,verdict:'approved'}),/brief/);
const brief={reader_task:'Compare the documented requirements',direct_answer:'The verified comparison answers the question',unique_value:'A documented condition comparison',editorial_owner:'Fixture reviewer',maintenance_owner:'Fixture owner',review_due_at:'2099-01-01',value_source_ids:[evidence.id],demand_source_ids:[evidence.id],demand_status:'search_surface_observed',serp_comparison:[{source_id:evidence.id,missing_answer:'Missing conditions',our_answer:'Verified conditions'}],claim_source_map:[{claim:'Condition A',source_id:evidence.id,locator:'Table 1'}],existing_coverage:'Improve existing page',internal_links:[],unresolved_questions:[],research:{skills_used:['seo-report'],score_rationale:'Fixture scores only',demand:20,serp_opportunity:20,site_fit:80,business_value:40,freshness:50,effort:30}};
await blogCommands.prepare(agent,{projectId:p.id,pageId:plan.page.id,brief});
await assert.rejects(()=>blogCommands.export(agent,{projectId:p.id,pageId:plan.page.id}),/approved/);
await planningCommands.pageReview(human,{projectId:p.id,pageId:plan.page.id,verdict:'approved'});
const handoff=await blogCommands.export(agent,{projectId:p.id,pageId:plan.page.id});
assert.equal(handoff.target_sources[0].sha256,'b'.repeat(64));
assert.deepEqual(await blogCommands.export(agent,{projectId:p.id,pageId:plan.page.id}),handoff);
const event=(status:string,extra:any={})=>({schema_version:1,event_id:`${handoff.handoff_id}-${status}`,handoff_id:handoff.handoff_id,version_hash:handoff.version_hash,status,occurred_at:new Date().toISOString(),blog_item_id:'task-1',evidence_refs:['quality.json','build.json'],final_urls:handoff.target_urls,...extra});
await assert.rejects(()=>blogCommands.receipt(agent,{projectId:p.id,receipt:event('published')}),/transition/);
const accepted=event('accepted');
await blogCommands.receipt(agent,{projectId:p.id,receipt:accepted});
assert.equal((await blogCommands.receipt(agent,{projectId:p.id,receipt:accepted})).duplicate,true);
await assert.rejects(()=>blogCommands.receipt(agent,{projectId:p.id,receipt:{...accepted,reason:'tampered'}}),/collision/);
await blogCommands.receipt(agent,{projectId:p.id,receipt:event('local_verified')});
await blogCommands.receipt(agent,{projectId:p.id,receipt:event('published',{publication:{confirmed_at:new Date().toISOString(),checks:[{url:handoff.target_urls[0],http_status:200,canonical:handoff.target_urls[0]}]}})});
// Simulate elapsed time only in the isolated fixture, then exercise real capture commands.
sqlite.prepare('UPDATE blog_handoffs SET published_at=? WHERE id=?').run('2025-02-01T00:00:00.000Z',handoff.handoff_id);
process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN='fixture-token';process.env.KEYWORDS_SERPER_API_KEY='fixture-token';
const savedFetch=globalThis.fetch;let calls=0;
globalThis.fetch=async(_url:any,options:any)=>{
 calls++;const request=JSON.parse(options.body);
 if(request.dimensions){assert.equal(request.dimensions.join(','),'query,page');assert.ok(request.dimensionFilterGroups[0].filters[0].expression.includes('example'));return new Response(JSON.stringify({rows:[{keys:['fixture query','https://example.com/a/'],clicks:request.startDate==='2025-01-01'?5:10,impressions:100,ctr:0.05,position:12}]}),{status:200});}
 return new Response(JSON.stringify({relatedSearches:[{query:'Unknown external wording'}],peopleAlsoAsk:[{question:'A new unexpected question?'}],organic:[]}),{status:200});
};
const before=await blogCommands.capture(agent,{projectId:p.id,startDate:'2025-01-01',endDate:'2025-01-28',siteUrl:'sc-domain:example.com'});
const after=await blogCommands.capture(agent,{projectId:p.id,startDate:'2025-02-02',endDate:'2025-03-01',siteUrl:'sc-domain:example.com'});
const evaluation=await blogCommands.evaluate(agent,{projectId:p.id,handoffId:handoff.handoff_id,baselineId:before.captureId,followupId:after.captureId});assert.equal(evaluation.verdict,'improved');
await blogCommands.receipt(agent,{projectId:p.id,receipt:event('evaluated',{outcome:{verdict:'improved',baseline_capture_id:before.captureId,followup_capture_id:after.captureId,summary:'Fixture observation'}})});
// A failed fetch must not erase a successful capture.
globalThis.fetch=async()=>new Response('failed',{status:403});
await assert.rejects(()=>blogCommands.capture(agent,{projectId:p.id,startDate:'2025-01-01',endDate:'2025-01-28',siteUrl:'sc-domain:example.com'}));
assert.ok(sqlite.prepare('SELECT id FROM blog_query_page_captures WHERE id=?').get(before.captureId));
globalThis.fetch=async()=>new Response(JSON.stringify({relatedSearches:[{query:'Unknown external wording'}],peopleAlsoAsk:[{question:'A new unexpected question?'}],organic:[]}),{status:200});
const {job}=await discoveryCommands.start(human,{projectId:p.id,seedKeywords:['original seed'],goal:'Fixture external discovery',maxExternalRequests:5,maxCandidates:3});
const claim=await discoveryCommands.claim(agent,{projectId:p.id,jobId:job.id});
const discovered=await discoveryCommands.expand(agent,{projectId:p.id,jobId:job.id,seed:'original seed'});assert.equal(discovered.newPhrases,2);
const observations=await discoveryCommands.observations(agent,{projectId:p.id,jobId:job.id}) as any[];
assert.equal(observations.length,2);assert.equal(observations[0].evidence_kind,'search_surface_observed');
await discoveryCommands.expand(agent,{projectId:p.id,jobId:job.id,parentId:observations[0].id});
await assert.rejects(()=>discoveryCommands.expand({...agent,actorId:'wrong'},{projectId:p.id,jobId:job.id,seed:'original seed'}),/executor/);
await workCommands.checkpoint(agent,{projectId:p.id,sessionId:claim.workSessionId,state:'blocked',summary:'Fixture pause'});
await assert.rejects(()=>discoveryCommands.expand(agent,{projectId:p.id,jobId:job.id,seed:'original seed'}),/session/);
await assert.rejects(()=>blogCommands.prepare(agent,{projectId:p.id,pageId:plan.page.id,brief}),/paused/);
await workCommands.cancel(human,{projectId:p.id,sessionId:claim.workSessionId,reason:'Fixture complete'});
globalThis.fetch=savedFetch;
await planningCommands.pageReview(human,{projectId:p.id,pageId:plan.page.id,verdict:'needs_edit'});
assert.equal((await blogCommands.get(agent,{projectId:p.id,handoffId:handoff.handoff_id})).valid,false);
assert.ok(calls>=2);
console.log(JSON.stringify({passed:true,database:process.env.KEYWORDS_DB_PATH,checks:['binding isolation','local != published','evidence gate','human approval','idempotent export/receipts','ordered lifecycle','GSC pairing','failed capture preservation','external phrase discovery','lease/pause','revocation']}));
