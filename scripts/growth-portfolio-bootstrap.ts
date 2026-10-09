import { growthInitiativeCreate,growthInitiativeList,distributionExperimentCreate,distributionExperimentList } from '../packages/commands/src/growth-operations.js';
import { seoPlanningDigestGet } from '../packages/commands/src/seo-planning-digest.js';
import { siteRegistryGet } from '../packages/commands/src/remote-site-operations.js';

// Idempotent candidate bootstrap using existing measured site data.
// Nothing is approved, pushed, merged, deployed or posted by this script.
const cases=[
  {siteId:'wiki-job-world',dedupeKey:'job-world:graph-path-distribution:20261009',
   title:'仕事の意外な親戚を「根拠のある経路カード」で流通させる',
   hypothesis:'実在150職業の隣接関係と説明を使った経路カードなら職業名リストより共有・訪問・探索を引き起こせる可能性がある。',
   audience:'職業・進路・雑学に関心がある人',
   userJob:'知っている仕事から、知らなかった仕事を発見したい',
   program:'distribution' as const,objectiveMetric:'referral_sessions' as const,
   assetUrl:'https://job.antonbase.com/jobs',
   observation:'職業データ、実在するつながり、職業ごとのOGP画像がソースとしてある。アカウントや外部投稿許可は未確定。',
   rollback:'配布素材を撤回し、元の職業グラフと実データを維持する。',
   falsification:'公開後に外部からのリンククリックや実際の探索が観測できなければ、カードの価値と配布先を見直す。'},
  {siteId:'yohaku',dedupeKey:'yohaku:household-conditions-tools:20261009',
   title:'余白を20代生活条件ツールを使うために訪れるメディアへ育てる',
   hypothesis:'手取り・家賃など実際の条件を入力・比較できる実用品があれば、意見記事より検索・共有・再訪の理由が生まれる。',
   audience:'生活費や働き方を考える20代',
   userJob:'自分の収入と生活条件の関係を比較したい',
   program:'organic_product' as const,objectiveMetric:'organic_sessions' as const,
   assetUrl:'https://yohaku.antonbase.com/rent-share-of-takehome/',
   observation:'手取り・家賃比率のコードは作成済み。ただし公開ドメインの反映確認は未完了。いまの20代向け方針と旧恋愛アカウントのずれに注意。',
   rollback:'新たな比較面だけ撤回し既存記事・計算機・個人情報不送信を維持する。',
   falsification:'本番実装・検索面・利用率が確認できなければ規模を広げない。'}
];
const now=()=>new Date().toISOString();
for(const x of cases){
 const site=await siteRegistryGet({id:x.siteId});
 if(site.status!=='active'){console.log('inactive site skipped',x.siteId);continue}
 const existing=(await growthInitiativeList({siteId:x.siteId,limit:100})).items;
 if(existing.some(i=>i.dedupeKey===x.dedupeKey)){console.log('already exists',x.siteId);continue}
 const digest=await seoPlanningDigestGet({siteId:x.siteId}) as any;
 const ga4=digest.siteMetrics?.current28?.ga4;
 const complete=x.objectiveMetric==='organic_sessions'&&digest.statuses?.current28?.ga4?.completeness==='complete'&&typeof ga4?.organicSessions==='number';
 const period=digest.periods?.current28??{start:'2026-09-08',end:'2026-10-05'};
 const record=await growthInitiativeCreate({
  siteId:x.siteId,dedupeKey:x.dedupeKey,title:x.title,hypothesis:x.hypothesis,
  audience:x.audience,userJob:x.userJob,program:x.program,objectiveMetric:x.objectiveMetric,
  assetUrl:x.assetUrl,sourceObservations:[{url:x.assetUrl,observedAt:now(),finding:x.observation}],
  baseline:{start:period.start,end:period.end,completeness:complete?'complete':'missing',
    value:complete?ga4.organicSessions:null,
    source:complete?'Complete 28d Sites Operator GA4 digest':'Attributable channel baseline not yet measured'},
  plannedReviewDays:[14,28],ownerRole:'site_growth_manager',
  rollback:x.rollback,falsification:x.falsification,
  guardrails:['No invented launch or traffic results','No unauthorised social posting','No broad SEO-indexation changes']
 });
 console.log('created candidate',record.id,x.siteId);
 if(x.siteId==='wiki-job-world'){
  const existingDist=(await distributionExperimentList({siteId:x.siteId,limit:100})).items;
  if(!existingDist.some(d=>d.dedupeKey==='job-world:job-graph-x:20261009')){
   const experiment=await distributionExperimentCreate({
    siteId:x.siteId,initiativeId:record.id,dedupeKey:'job-world:job-graph-x:20261009',
    channel:'x',sourceAssetRef:'source-backed two-hop job graph card (not yet produced)',
    targetUrl:'https://job.antonbase.com/jobs',utmCampaign:'job_graph_explore',creativeVariant:'twostep_card_v1',
    guardrails:['idea only; no authorized account or approved campaign yet','no posting']
   });
   console.log('created distribution IDEA',experiment.id);
  }
 }
}
console.log('bootstrap complete: only candidate/idea records, no external actions');
