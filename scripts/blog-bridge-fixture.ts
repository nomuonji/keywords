// Cross-runtime fixture helper. Refuse to run against a non-test database.
import { readFileSync } from 'node:fs';
if(!process.env.KEYWORDS_DB_PATH?.includes('keywords-bridge-test-'))throw new Error('Isolated bridge-test database required');
const {commands}=await import('@keywords/commands');
const {blogCommands}=await import('@keywords/commands/blog');
const {planningCommands}=await import('@keywords/commands/planning');
const {getDatabase}=await import('@keywords/db');
const snapshot=JSON.parse(readFileSync(process.argv[2],'utf8'));
const human={actor:'human' as const,actorId:'fixture'},agent={actor:'agent' as const,actorId:'fixture'};
const project=await commands.project.create(human,{name:'Bridge test fixture',domain:new URL(snapshot.canonical_origin).hostname});
await blogCommands.importContext(human,{projectId:project.id,snapshot});
const source=await commands.source.record(agent,{projectId:project.id,type:'serp',label:'Fixture evidence',metadata:{fixture:true,query:'bridge test'}});
const keyword=await commands.keyword.create(agent,{projectId:project.id,text:'bridge test'});
const target=getDatabase().sqlite.prepare('SELECT id FROM pages WHERE project_id=? AND url=?').get(project.id,snapshot.sources[0].expected_url) as {id:string};
const {page}=await planningCommands.pagePlan(agent,{projectId:project.id,title:'Fixture improvement',primaryKeywordId:keyword.id,sourceIds:[source.id],planMode:'existing_page_improvement',targetPageId:target.id});
await blogCommands.prepare(agent,{projectId:project.id,pageId:page.id,brief:{reader_task:'Fixture question',direct_answer:'Fixture answer',unique_value:'Fixture material',editorial_owner:'Fixture reviewer',maintenance_owner:'Fixture owner',review_due_at:'2099-01-01',value_source_ids:[source.id],demand_source_ids:[source.id],demand_status:'search_surface_observed',serp_comparison:[{source_id:source.id,missing_answer:'Fixture gap',our_answer:'Fixture addition'}],claim_source_map:[{claim:'Fixture claim',source_id:source.id,locator:'Fixture section'}],existing_coverage:'Existing fixture target',internal_links:[],unresolved_questions:[],research:{skills_used:['seo-report'],score_rationale:'Fixture',demand:20,serp_opportunity:20,site_fit:20,business_value:20,freshness:20,effort:20}}});
await planningCommands.pageReview(human,{projectId:project.id,pageId:page.id,verdict:'approved'});
console.log(JSON.stringify(await blogCommands.export(agent,{projectId:project.id,pageId:page.id})));
