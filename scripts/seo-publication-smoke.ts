import assert from 'node:assert/strict';
import { matchingPagesProject, completedProductionPagesDeployment, duePublicationBatch } from './seo-publication-evidence.js';

const repo = {name:'job-world',source:{config:{owner:'nomuonji',repo_name:'job-world'}},domains:['job.antonbase.com']};
const whisky = {name:'whisky-en',source:{config:{owner:'nomuonji',repo_name:'whisky-media-en'}},domains:['whisky-en.antonbase.com']};
assert.equal(matchingPagesProject([repo,whisky],'nomuonji/job-world','job.antonbase.com')?.name,'job-world');
assert.equal(matchingPagesProject([repo,whisky],'nomuonji/whisky-media-en','whisky-en.antonbase.com')?.name,'whisky-en');
assert.equal(matchingPagesProject([repo,whisky],'other/repository','job.antonbase.com')?.name,'job-world');
assert.equal(matchingPagesProject([repo,whisky],'other/repository','not-registered.example'),null);
assert.equal(matchingPagesProject([repo,{...repo,name:'ambiguous'}],'nomuonji/job-world','job.antonbase.com'),null);

const sha='a'.repeat(40);
const production={environment:'production',skipped:false,latest_stage:{name:'deploy',status:'success'},deployment_trigger:{metadata:{commit_hash:sha}}};
assert.equal(completedProductionPagesDeployment(production),sha);
assert.equal(completedProductionPagesDeployment({...production,environment:'preview'}),null);
assert.equal(completedProductionPagesDeployment({...production,skipped:true}),null);
assert.equal(completedProductionPagesDeployment({...production,latest_stage:{name:'deploy',status:'active'}}),null);
assert.equal(completedProductionPagesDeployment({...production,deployment_trigger:{metadata:{commit_hash:'bad'}}}),null);

// A permanently blocked old Task must not monopolize every scheduled batch.
const clock=Date.parse('2026-10-17T00:17:00Z');
const backlog=Array.from({length:43},(_,i)=>({id:String(i).padStart(2,'0'),completedAt:'2026-10-09T00:00:00Z',deploymentVerification:{checkedAt:null}}));
const batches=Array.from({length:4},(_,i)=>duePublicationBatch(backlog,clock+i*2*60*60*1000,12));
assert.deepEqual(new Set(batches.flat().map(x=>x.id)).size,43);
assert.ok(batches.every(items=>items.length===12));
assert.deepEqual(duePublicationBatch(backlog,clock,0),[]);
assert.deepEqual(duePublicationBatch([{...backlog[0],deploymentVerification:{checkedAt:new Date(clock-60_000).toISOString()}}],clock,12),[]);
assert.equal(duePublicationBatch([{...backlog[0],deploymentVerification:{checkedAt:new Date(clock-86_400_000).toISOString()}}],clock,12).length,1);
console.log('Publication evidence filters production deployments and rotates due backlog without extra database writes.');
