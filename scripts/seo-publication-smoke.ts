import assert from 'node:assert/strict';
import { matchingPagesProject, completedProductionPagesDeployment } from './seo-publication-evidence.js';

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

console.log('Publication evidence selects exact production deployment, excludes preview/skipped builds.');
