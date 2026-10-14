import assert from 'node:assert/strict';
import { marketDiscoveryRun, assessDiscoveryGate } from '../packages/commands/src/market-discovery-runner.js';

const fakeDistribution = async () => ({
  cases: Array.from({length: 8},(_,i)=>({
    sourcePlatform:'hatena_bookmark', sourceId:'hatena_life',title:'Independent observed topic '+i,
    destinationUrl:'https://example'+i+'.org/real-study',publishedAt:'2026-10-14T00:00:00.000Z',
    engagement:[{metric:'bookmarks',value:20}],observedTags:['daily-life']
  })),
  observedNiches:[{name:'daily-life',exampleUrl:'https://example0.org/real-study'}]
});
const fakeSignals = async () => ({
  results:[{source:'google_trends',observations:[
    {source:'google_trends',label:'New observed subject',url:'https://trends.google.com/trending?geo=JP',
      observedAt:'2026-10-14T00:00:00.000Z',metrics:{approxTraffic:1000}}
  ]}]
});
const dry = await marketDiscoveryRun({phase:'observe',mode:'db_site',maxObservations:16}, {
  distribution:fakeDistribution as any,signals:fakeSignals as any,
  products:(async()=>{throw Error('DB discovery must not call product rankings')}) as any
});
assert.equal(dry.phase,'observe');
assert.equal(dry.observations.length,9);
assert.equal(dry.coverage.sufficientForInitialHypotheses,true);
assert.deepEqual(dry.coverage.families,['curated_public_discussion','search_attention']);
assert.equal(dry.writes,0);
assert.equal(dry.observations.filter((x:any)=>x.family==='ranked_commerce').length,0);

const fakeGap = async () => ({
  serp:{provider:'api',results:[
    {title:'Current directory',link:'https://competa.example/page',snippet:'existing directory'},
    {title:'Other directory',link:'https://competb.example/page',snippet:'other directory'}]},
  pages:[{url:'https://competa.example/page',status:'read',text:'Current directory handles a subset.'},
    {url:'https://competb.example/page',status:'read',text:'Other page handles a subset.'}],
  observations:[{url:'https://data.example.gov/catalog',status:'read',text:'First-party data available.'}]
});
const validated = await marketDiscoveryRun({
  phase:'validate',mode:'db_site',
  candidates:[{name:'Real-world database',audience:'People looking for an answer',
    userNeed:'Cannot find all known conditions in one place',
    databaseUnit:'observed entry',interaction:'filter by time and source',
    query:'real world directory',evidenceUrls:['https://data.example.gov/catalog']}]
},{gap:fakeGap as any,demand:async()=>({results:[{keyword:'real world directory',avgMonthlySearches:0}]})});
assert.equal(validated.phase,'validate');
assert.equal(validated.results[0].gate.status,'editorial_review_required');
assert.equal(validated.results[0].gate.canClaimVerifiedOpportunity,false);
assert.equal(validated.results[0].verdict,'review_required_not_an_approved_or_verified_market');
const insufficient=assessDiscoveryGate({competitorPages:[{url:'https://one.test',status:'unavailable'}],
  evidencePages:[],resultCount:2,demandAvailable:false});
assert.equal(insufficient.status,'insufficient_evidence');
assert.ok(insufficient.missing.includes('no_candidate_source_page_read'));
await assert.rejects(marketDiscoveryRun({phase:'observe',candidates:[{name:'invented'}]},{
  distribution:fakeDistribution as any,signals:fakeSignals as any
}));
await assert.rejects(marketDiscoveryRun({phase:'validate',candidates:[]}));
console.log('staged market discovery: read-only observation, source independence and non-promotion gates passed');
