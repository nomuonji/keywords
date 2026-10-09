import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { field } from '../packages/db/src/firestore.js';
import {
  growthInitiativeCreate,growthInitiativeGet,growthInitiativeList,growthInitiativeUpdate,
  distributionExperimentCreate,distributionExperimentGet,distributionExperimentList,distributionExperimentUpdate
} from '../packages/commands/src/growth-operations.js';

// Fully offline Firestore double: validates atomic optimistic writes without
// using provider credentials, publishing platforms or live portfolio records.
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
process.env.FIREBASE_SERVICE_ACCOUNT_JSON=JSON.stringify({
  client_email:'test@example.com',
  private_key:privateKey.export({type:'pkcs8',format:'pem'}),project_id:'test'
});
process.env.FIREBASE_PROJECT_ID='test';
process.env.KEYWORDS_FIRESTORE_WRITE_DELAY_MS='0';
const base='projects/test/databases/(default)/documents/';
const docs=new Map<string,any>();
let seq=1;
const originalFetch=globalThis.fetch;
docs.set(base+'sites/site-a',{
  name:base+'sites/site-a',updateTime:'fixture-1',
  fields:{
    id:field('site-a'),status:field('active'),productionUrl:field('https://site.example/'),
    siteShape:field('product'),name:field('Site A'),repository:field('nomuonji/site-a')
  }
});
docs.set(base+'sites/site-b',{
  name:base+'sites/site-b',updateTime:'fixture-2',
  fields:{
    id:field('site-b'),status:field('active'),productionUrl:field('https://other.example/'),
    siteShape:field('article'),name:field('Site B'),repository:field('nomuonji/site-b')
  }
});
const decoded=(x:any)=>x?.stringValue??(x?.integerValue!==undefined?Number(x.integerValue):x?.doubleValue??x?.booleanValue??null);
globalThis.fetch=async(input,init)=>{
  const url=String(input);
  if(url==='https://oauth2.googleapis.com/token')
    return Response.json({access_token:'fixture-token',expires_in:3600});
  assert.ok(url.startsWith('https://firestore.googleapis.com/v1/'),url);
  const p=new URL(url),name=p.pathname.replace('/v1/','');
  const body=init?.body?JSON.parse(String(init.body)):null;
  if(name.endsWith(':commit')){
    for(const write of body.writes){
      const prev=docs.get(write.update.name);
      if(write.currentDocument?.exists===false&&prev)return Response.json({}, {status:409});
      if(write.currentDocument?.updateTime&&prev?.updateTime!==write.currentDocument.updateTime)
        return Response.json({}, {status:409});
    }
    for(const write of body.writes){
      docs.set(write.update.name,{...write.update,updateTime:'seq-'+seq++});
    }
    return Response.json({});
  }
  if(name.endsWith(':runQuery')){
    const q=body.structuredQuery,c=q.from[0].collectionId;
    const wanted=decoded(q.where.fieldFilter.value);
    return Response.json([...docs.values()].filter(x=>
      x.name.startsWith(base+c+'/')&&decoded(x.fields?.siteId)===wanted
    ).slice(0,q.limit??500).map(document=>({document})));
  }
  if(name.endsWith('/growthInitiatives')||name.endsWith('/distributionExperiments')){
    const collection=name.split('/').at(-1)!;
    return Response.json({documents:[...docs.values()].filter(x=>x.name.startsWith(base+collection+'/'))});
  }
  return docs.has(name)?Response.json(docs.get(name)):Response.json({},{status:404});
};

const at='2026-10-09T04:00:00.000Z';
const observation={url:'https://site.example/jobs',observedAt:at,finding:'Observed job graph and an existing discovery surface.'};
const baseInput={
  id:'initiative-a',siteId:'site-a',dedupeKey:'job-graph-2026-10',
  title:'Discover adjacent occupations',
  hypothesis:'Visitors will engage with real graph paths as opposed to generic job articles.',
  audience:'Career-curious readers',userJob:'I know one job and want to explore adjacent ones.',
  program:'organic_product',objectiveMetric:'organic_sessions',
  sourceObservations:[observation],baseline:{
    start:'2026-09-08',end:'2026-10-05',completeness:'missing',value:null,source:'GSC credential blocked'
  },
  ownerRole:'growth_manager',rollback:'Disable one connected graph entry page.',
  falsification:'No qualified visits or follow-on exploration after adequate launch observation.',
  guardrails:['Do not auto-post or create indexable query permutations']
};
const expectFail=async(fn:()=>Promise<unknown>,re:RegExp)=>{
  await assert.rejects(fn,re);
};
try{
  await expectFail(()=>growthInitiativeCreate({...baseInput,sourceObservations:[]}),/too_small|Too small|at least|expected array/i);
  await expectFail(()=>growthInitiativeCreate({...baseInput,assetUrl:'https://not-ours.example/'}),/origin/);
  const created=await growthInitiativeCreate(baseInput);
  assert.equal(created.status,'candidate');
  assert.equal(created.approval,null);
  assert.equal(created.launchProof,null);
  assert.equal(created.baseline.value,null);
  assert.equal((await growthInitiativeGet({id:'initiative-a'})).status,'candidate');
  assert.equal((await growthInitiativeList({siteId:'site-a'})).items.length,1);
  await expectFail(()=>growthInitiativeCreate(baseInput),/dedupeKey/);
  await expectFail(()=>growthInitiativeUpdate({id:'initiative-a',expectedRevision:1,status:'live',actor:'tester'}),/transition/);
  await expectFail(()=>growthInitiativeUpdate({id:'initiative-a',expectedRevision:1,status:'approved',actor:'tester'}),/Approval/);
  const approved=await growthInitiativeUpdate({
    id:'initiative-a',expectedRevision:1,status:'approved',actor:'human_owner',
    approval:{approvedBy:'human_owner',approvedAt:at,decisionReason:'Approve a contained first-party growth pilot.'}
  });
  assert.equal(approved.status,'approved');
  const building=await growthInitiativeUpdate({id:'initiative-a',expectedRevision:2,status:'building',assetUrl:'https://site.example/jobs',actor:'builder'});
  assert.equal(building.status,'building');
  const example={
    id:'experiment-a',siteId:'site-a',initiativeId:'initiative-a',dedupeKey:'x-graph',
    channel:'x',sourceAssetRef:'https://site.example/jobs',targetUrl:'https://site.example/jobs',
    utmCampaign:'occupation_graph',creativeVariant:'graph-path-1'
  };
  await expectFail(()=>distributionExperimentCreate({...example,siteId:'site-b'}),/Cross-site/);
  await expectFail(()=>distributionExperimentCreate({...example,targetUrl:'https://other.example/jobs'}),/registered site/);
  const planned=await distributionExperimentCreate(example);
  assert.equal(planned.state,'idea');
  await expectFail(()=>distributionExperimentUpdate({id:'experiment-a',expectedRevision:1,state:'ready',actor:'test'}),/verified live/);
  await expectFail(()=>growthInitiativeUpdate({id:'initiative-a',expectedRevision:3,status:'live',actor:'tester'}),/actual production proof/);
  const launched=await growthInitiativeUpdate({
    id:'initiative-a',expectedRevision:3,status:'live',actor:'release_proof',
    launchProof:{
      productionUrl:'https://site.example/jobs',sourceCommitSha:'a'.repeat(40),
      verifiedAt:at,method:'provider_deployment',
      detail:'Fixture deployment: provider returned the exact main SHA and production alias.'
    }
  });
  assert.equal(launched.status,'live');
  assert.ok(launched.nextReviewAt);
  const ready=await distributionExperimentUpdate({id:'experiment-a',expectedRevision:1,state:'ready',actor:'owner'});
  assert.equal(ready.state,'ready');
  await expectFail(()=>distributionExperimentUpdate({id:'experiment-a',expectedRevision:2,state:'published',actor:'publisher'}),/post URL/);
  const posted=await distributionExperimentUpdate({
    id:'experiment-a',expectedRevision:2,state:'published',actor:'publisher',
    publishReceipt:{platformPostUrl:'https://x.com/example/status/123',publishedAt:at,externalId:'123'}
  });
  assert.equal(posted.state,'published');
  await expectFail(()=>distributionExperimentUpdate({id:'experiment-a',expectedRevision:3,state:'observed',actor:'analyst'}),/measured metrics/);
  const observed=await distributionExperimentUpdate({
    id:'experiment-a',expectedRevision:3,state:'observed',actor:'analyst',
    metrics:{impressions:100,outboundClicks:3,referralSessions:null,recordedAt:at,sourceUrl:'https://x.com/example/status/123'}
  });
  assert.equal(observed.metrics?.referralSessions,null);
  assert.equal((await distributionExperimentGet({id:'experiment-a'})).state,'observed');
  assert.equal((await distributionExperimentList({siteId:'site-a',state:'observed'})).items.length,1);
  await expectFail(()=>distributionExperimentUpdate({id:'experiment-a',expectedRevision:3,actor:'analyst',note:'stale'}),/Revision conflict/);
  const evaluated=await growthInitiativeUpdate({
    id:'initiative-a',expectedRevision:4,status:'evaluating',actor:'analyst',
    appendMeasurement:{
      metric:'organic_sessions',start:'2026-10-10',end:'2026-10-20',
      completeness:'partial',value:null,sourceUrl:'https://analytics.google.com/',
      recordedAt:'2026-10-21T00:00:00.000Z',note:'Pending complete period; no numeric claim.'
    }
  });
  assert.equal(evaluated.measurements[0].value,null);
  assert.equal(evaluated.status,'evaluating');
  assert.equal((await growthInitiativeList({status:'evaluating'})).items.length,1);
  assert.ok([...docs.keys()].some(key=>key.startsWith(base+'runs/')),'auditable atomic Firestore writes');
  assert.ok([...docs.keys()].filter(key=>key.startsWith(base+'distributionExperiments/')).length===1);
  console.log('growth operations smoke passed: candidate/approval, dedupe, revision, cross-site boundaries, verified asset, native post receipt, honest missing measurements, audit writes; no publishing invoked');
}finally{
  globalThis.fetch=originalFetch;
}
