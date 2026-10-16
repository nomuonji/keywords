import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { compareIdeas, ideaMemoryBatchUpsert, ideaMemorySearch, ideaMemoryContext, ideaFeedbackAppend, ideaMemoryFeedbackProfile, ideaReviewList, ideaReviewDetail, ideaMemoryPatch } from '../packages/commands/src/idea-memory.js';
import { value } from '../packages/db/src/firestore.js';

const privateKey = generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({project_id:'test',client_email:'test@example.com',private_key:privateKey});
process.env.KEYWORDS_FIRESTORE_RETRY_ATTEMPTS = '0';
const db = new Map<string,any>(); let reads = 0, commits = 0, writes = 0;
const json = (body:any,status=200) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
globalThis.fetch = async (input:any, init?:RequestInit) => {
  const url = String(input);
  if (url.includes('oauth2.googleapis.com')) return json({access_token:'test-token',expires_in:3600});
  const target = new URL(url);
  const path = decodeURIComponent(target.pathname.split('/documents')[1] ?? '') + target.search;
  if (path === ':commit') {
    commits++; const body = JSON.parse(String(init?.body));
    for (const w of body.writes) {
      const key = w.update.name.split('/documents/')[1]; const previous = db.get(key);
      if (w.currentDocument.exists === false && previous) return json({error:'conflict'},409);
      if (w.currentDocument.updateTime && previous?.updateTime !== w.currentDocument.updateTime) return json({error:'conflict'},409);
    }
    for (const w of body.writes) { const key=w.update.name.split('/documents/')[1]; db.set(key,{...w.update,updateTime:String(Date.now()+writes)}); writes++; }
    return json({writeResults:body.writes.map(()=>({}))});
  }
  if (path === ':runQuery') {
    reads++; const body = JSON.parse(String(init?.body)); const ts = (body.structuredQuery.where.fieldFilter.value.arrayValue.values ?? []).map((v:any)=>value(v));
    return json([...db].filter(([k,d])=>k.startsWith('ideaMemory/') && (d.fields.searchTokens.arrayValue.values ?? []).some((v:any)=>ts.includes(value(v)))).slice(0,100).map(([,document])=>({document})));
  }
  if (path.startsWith('/ideaMemory?') || path.startsWith('/ideaFeedback?') || path.includes('/themeCandidates?')) {
    reads++; const [collection,qs] = path.slice(1).split('?'); const params = new URLSearchParams(qs);
    const entries=[...db].filter(([k])=>k.startsWith(`${collection}/`)).sort(([a],[b])=>params.get('orderBy')?.includes('desc')?b.localeCompare(a):a.localeCompare(b));
    const start=Number(params.get('pageToken') ?? 0), size=Number(params.get('pageSize') ?? 30);
    return json({documents:entries.slice(start,start+size).map(([,d])=>d),nextPageToken:start+size<entries.length?String(start+size):undefined});
  }
  reads++; const key=path.slice(1); const found=db.get(key); return found ? json(found) : json({error:'not found'},404);
};
const base = { audience:'廃校を訪ねる旅行者',userTask:'廃校の現在の使われ方を知る',entities:'学校跡地と新しい施設',informationMechanism:'閉校から再利用までの年表',interaction:'地図から場所を選び変遷を見る',maintenance:'年一回確認' };
const ideas=Array.from({length:30},(_,i)=>({...base,id:`smoke-${i}`,title:`廃校のその後 ${i}`,entities:`学校跡地と新しい施設 ${i}`,presentedAt:'2026-10-14T00:00:00.000Z'}));
const first=await ideaMemoryBatchUpsert({ideas,runId:'smoke-run'});
assert.equal(first.results.length,30); assert.equal(first.writeCount,30); assert.equal(commits,1);
const second=await ideaMemoryBatchUpsert({ideas,runId:'smoke-run'});
assert.equal(second.writeCount,0); assert.equal(writes,30); assert.equal(commits,1);
const renamed={...base,title:'閉校した学校は今どう使われるか'};
assert.equal(compareIdeas(renamed,ideas[0]).relation,'near_duplicate');
const different={...base,title:'廃校を使ったイベント予約',userTask:'廃校で開催されるイベントを予約する',informationMechanism:'イベントの日程表',interaction:'日付で空席を選び予約する'};
assert.equal(compareIdeas(different,ideas[0]).relation,'related_not_duplicate');
const matches=await ideaMemorySearch({candidate:renamed,limit:5,includeRejected:true}); assert.ok(matches.matches.some((v:any)=>v.relation==='near_duplicate'));
const page=await ideaMemoryContext({limit:10}); assert.equal(page.ideas.length,10); assert.ok(page.nextCursor);
const next=await ideaMemoryContext({limit:10,cursor:page.nextCursor}); assert.equal(next.ideas.length,10);
await ideaFeedbackAppend({ideaId:'smoke-0',scope:'specific_idea',polarity:'negative',reason:'対象が曖昧',feedback:'この案は不要',source:'direct_user',sourceDate:'2026-10-14T00:00:00.000Z',statusAfter:'rejected',idempotencyKey:'negative-0'});
await ideaFeedbackAppend({ideaId:'smoke-1',scope:'specific_idea',polarity:'positive',reason:'使える',feedback:'採用',source:'direct_user',sourceDate:'2026-10-14T00:00:00.000Z',statusAfter:'liked',idempotencyKey:'positive-1',axes:{appeal:4,revenue:3}});
await ideaFeedbackAppend({scope:'whole_batch',polarity:'negative',reason:'根拠が薄い',feedback:'提案品質が悪い',source:'direct_user',sourceDate:'2026-10-14T00:00:00.000Z',idempotencyKey:'broad'});
const retry=await ideaFeedbackAppend({scope:'whole_batch',polarity:'negative',reason:'根拠が薄い',feedback:'提案品質が悪い',source:'direct_user',sourceDate:'2026-10-14T00:00:00.000Z',idempotencyKey:'broad'});
assert.equal(retry.outcome,'unchanged');
const profile=await ideaMemoryFeedbackProfile({limit:10}); assert.equal(profile.events.length,3);
const inbox = await ideaReviewList({limit:10}); assert.equal(inbox.items.length,10); assert.ok(inbox.nextCursor);
assert.equal(value(db.get('ideaMemory/smoke-2').fields.status),'unreviewed');
assert.equal(value(db.get('ideaMemory/smoke-0').fields.status),'rejected');
assert.equal(value(db.get('ideaMemory/smoke-1').fields.status),'liked');
const detail=await ideaReviewDetail('smoke-0'); assert.ok(detail);
const revised=await ideaMemoryPatch({ideaId:'smoke-0',expectedRevision:detail.revision,
  tags:['消費行動','ネット文化','消費行動'],
  destinations:['social_content','youtube_video','social_content'],
  assetRefs:[{id:'asset-script-1',destination:'youtube_video',kind:'youtube_script',
    title:'廃校の謎・YouTube台本案',owner:'Idea Memory',stage:'proposed'}]});
assert.equal(revised.idea.status,'rejected','organization cannot change the human verdict');
assert.deepEqual(revised.idea.tags,['消費行動','ネット文化']);
assert.deepEqual(revised.idea.destinations,['social_content','youtube_video']);
assert.equal(revised.idea.assetCount,1);
const noChange=await ideaMemoryPatch({ideaId:'smoke-0',expectedRevision:revised.idea.revision,
  tags:['消費行動','ネット文化'],destinations:['social_content','youtube_video'],assetRefs:revised.idea.assetRefs});
assert.equal(noChange.outcome,'unchanged');
await assert.rejects(()=>ideaMemoryPatch({ideaId:'smoke-0',expectedRevision:detail.revision,tags:[]}),/conflict/i);
const after=await ideaReviewDetail('smoke-0');assert.equal(after?.status,'rejected');
// Per-outlet verdicts are independent of the idea-wide judgement and of other outlets.
const videoReview = await ideaFeedbackAppend({ideaId:'smoke-0',destination:'youtube_video',
  scope:'specific_idea',polarity:'positive',reason:'動画の企画としては使える',feedback:'動画ではGOOD',
  source:'direct_user',sourceDate:'2026-10-16T00:00:00.000Z',statusAfter:'liked',idempotencyKey:'video-good-0'});
assert.equal(videoReview.event.destination,'youtube_video');
const snsReview = await ideaFeedbackAppend({ideaId:'smoke-0',destination:'social_content',
  scope:'specific_idea',polarity:'negative',reason:'投稿には不向き',feedback:'SNSはボツ',
  source:'direct_user',sourceDate:'2026-10-16T00:00:00.000Z',statusAfter:'rejected',idempotencyKey:'social-reject-0'});
assert.equal(snsReview.event.destination,'social_content');
const scoped = await ideaReviewDetail('smoke-0');
assert.equal(scoped?.status,'rejected','destination decisions must not overwrite overall judgement');
assert.equal(scoped?.destinationVerdicts?.youtube_video,'liked');
assert.equal(scoped?.destinationVerdicts?.social_content,'rejected');
await assert.rejects(()=>ideaFeedbackAppend({ideaId:'smoke-0',destination:'product_affiliate',
  scope:'specific_idea',polarity:'positive',reason:'未振り分け',feedback:'未振り分け',
  source:'direct_user',sourceDate:'2026-10-16T00:00:00.000Z',statusAfter:'liked',idempotencyKey:'bad-route-0'}),/not assigned/);
await assert.rejects(()=>ideaFeedbackAppend({destination:'social_content',scope:'whole_batch',
  polarity:'positive',reason:'広い評価',feedback:'全体',
  source:'direct_user',sourceDate:'2026-10-16T00:00:00.000Z',idempotencyKey:'bad-broad'}),/Broad feedback/);
const summaries=await ideaReviewList({limit:100,summary:true});
assert.equal(summaries.items.find((item:any)=>item.id==='smoke-0')?.destinationVerdicts?.youtube_video,'liked');
const feedbackProfile=await ideaMemoryFeedbackProfile({limit:10});
assert.deepEqual(feedbackProfile.events.find((e:any)=>e.ideaId==='smoke-1')?.axes,{appeal:4,revenue:3});
assert.ok(reads < 110,'two extra outlet feedback writes and summary still require bounded reads'); assert.equal(writes,40);
const normalFetch = globalThis.fetch;
globalThis.fetch = async (input:any,init?:RequestInit) => String(input).includes('/documents:runQuery') ? json({error:'quota'},429) : normalFetch(input,init);
await assert.rejects(() => ideaMemorySearch({candidate:renamed,limit:5,includeRejected:true}),/Firestore request failed \(429\)/);
assert.equal(writes,40);
globalThis.fetch = normalFetch;
console.log('Idea Memory smoke passed', {reads,writes,commits});
