import { lazy, Suspense, useEffect, useState } from 'react';
import { isRemoteBackend } from './api';
const OperationsOverview = lazy(() => import('./OperationsOverview').then(module => ({ default: module.OperationsOverview })));
const ArticlesOverview = lazy(() => import('./ArticlesOverview').then(module => ({ default: module.ArticlesOverview })));
const SitesOverview = lazy(() => import('./SitesOverview').then(module => ({ default: module.SitesOverview })));
const KeywordTreasury = lazy(() => import('./KeywordTreasury').then(module => ({ default: module.KeywordTreasury })));
const SiteStructures = lazy(() => import('./SiteStructures').then(module => ({ default: module.SiteStructures })));
const ThemeResearch = lazy(() => import('./ThemeResearch').then(module => ({ default: module.ThemeResearch })));
const SeoSourcePool = lazy(() => import('./SeoSourcePool').then(module => ({ default: module.SeoSourcePool })));
const MarketDiscovery = lazy(() => import('./MarketDiscovery').then(module => ({ default: module.MarketDiscovery })));
const IdeaReview = lazy(() => import('./IdeaReview').then(module => ({ default: module.IdeaReview })));

type DiscoveryTab='ideas'|'market'|'research'|'structures';
type View='operations'|'articles'|'sites'|'treasury'|'sources'|'discover';
const legacyDiscoveryViews=['ideas','market','research','structures'];
const discoveryTabs:Array<{id:DiscoveryTab;name:string;desc:string;step:string}>=[
  {id:'ideas',name:'アイデアストック',desc:'7つの出口・タグ・評価・派生成果物',step:'01 / SORT'},
  {id:'market',name:'市場を観測',desc:'外部実データから着想を得る',step:'02 / OBSERVE'},
  {id:'research',name:'仮説を検証',desc:'反証・リスク・次の調査',step:'03 / CHALLENGE'},
  {id:'structures',name:'サイトを設計',desc:'選んだサイト案のページ構造',step:'04 / PLAN'}
];
const views:Array<{id:View;label:string;hint:string}>=[
  {id:'operations',label:'運用',hint:'Issue・実行履歴'},
  {id:'sites',label:'サイト',hint:'Agent管理対象'},
  {id:'articles',label:'記事',hint:'管理・検証・成果'},
  {id:'treasury',label:'お宝KW',hint:'共有ストック'},
  {id:'sources',label:'情報源',hint:'X・媒体の監視プール'},
  {id:'discover',label:'発見・企画',hint:'観測から7つの出口へ'}
];

function readLocation(){
  const params=new URLSearchParams(window.location.search);
  const requested=params.get('view');
  // Remote backends now expose a bounded SEO Issue queue backed by Sites Operator.
  const fallback = 'operations' as View;
  const legacy=legacyDiscoveryViews.includes(requested??'');
  const tab=params.get('tab');
  const selectedTab=legacy ? requested : tab;
  return {
    view:legacy ? 'discover' as View : views.some(item=>item.id===requested) ? requested as View : fallback,
    tab:discoveryTabs.some(item=>item.id===selectedTab) ? selectedTab as DiscoveryTab : 'ideas' as DiscoveryTab,
    projectId:params.get('project')??''
  };
}

export function App(){
  const initial=readLocation();
  const [view,setView]=useState<View>(initial.view);
  const [discoveryTab,setDiscoveryTab]=useState<DiscoveryTab>(initial.tab);
  const [projectId,setProjectId]=useState(initial.projectId);
  const navigate=(next:View,nextProjectId=projectId,replace=false,nextTab=discoveryTab)=>{
    const params=new URLSearchParams();
    if(next!=='operations')params.set('view',next);
    if(next==='discover' && nextTab!=='ideas')params.set('tab',nextTab);
    if(nextProjectId)params.set('project',nextProjectId);
    const url=`${window.location.pathname}${params.size?`?${params}`:''}`;
    window.history[replace?'replaceState':'pushState']({},'',url);
    setView(next);setProjectId(nextProjectId);setDiscoveryTab(nextTab);
  };
  useEffect(()=>{const onPop=()=>{const next=readLocation();setView(next.view);setProjectId(next.projectId);setDiscoveryTab(next.tab)};window.addEventListener('popstate',onPop);return()=>window.removeEventListener('popstate',onPop)},[]);
  return <div className="coreShell">
    <a className="skipLink" href="#main-content">本文へ移動</a>
    <header className="coreTopbar">
      <button className="coreBrand" onClick={()=>navigate('operations','')} aria-label="今日の運用へ"><span/>KEYWORDS</button>
      <nav className="coreNav" aria-label="メインナビゲーション">{views.map(item=><button key={item.id} className={view===item.id?'active':''} aria-current={view===item.id?'page':undefined} onClick={()=>navigate(item.id)}><b>{item.label}</b><small>{item.hint}</small></button>)}</nav>
      <div className="coreTopMeta"><span className="stateDot live"/>{isRemoteBackend() ? 'remote · Firestore' : 'local workspace'}</div>
    </header>
    <main className="coreMain" id="main-content">
      <Suspense fallback={<section className="corePage" role="status"><p>画面を読み込んでいます…</p></section>}>
      {view==='operations'&&<OperationsOverview focusedProjectId={projectId} onFocusProject={id=>navigate('operations',id,true)} onOpenArticles={id=>navigate('articles',id??projectId)} onOpenSites={id=>navigate('sites',id??projectId)}/>}
      {view==='articles'&&<ArticlesOverview focusedProjectId={projectId} onFocusProject={id=>navigate('articles',id,true)} onOpenOperations={id=>navigate('operations',id)}/>}
      {view==='sites'&&<SitesOverview focusedProjectId={projectId} onClearProject={()=>navigate('sites','',true)} onOpenArticles={id=>navigate('articles',id)} onOpenOperations={id=>navigate('operations',id)}/>}
      {view==='treasury'&&<KeywordTreasury/>}
      {view==='sources'&&<SeoSourcePool/>}
      {view==='discover'&&<div className="discoveryWorkspace">
        <div className="discoveryHubIntro">
          <p className="coreEyebrow">DISCOVERY / IDEA MEMORY</p>
          <div className="discoveryHubTitle"><div><h1>発見から、使える企画へ。</h1>
            <p>市場の観測や研究は専門機能のまま残し、提案の正本・評価・展開先は共通Idea Memoryで管理します。</p>
          </div><span className="discoveryHubSource">1 IDEA DB <b>→</b> 7+ OUTLETS</span></div>
        </div>
        <nav className="discoveryHubTabs" aria-label="発見・企画ワークスペース">
          {discoveryTabs.map(item=><button key={item.id} type="button"
            className={discoveryTab===item.id?'active':''}
            aria-current={discoveryTab===item.id?'page':undefined}
            onClick={()=>navigate('discover','',false,item.id)}>
            <span className="discoveryHubStep">{item.step}</span>
            <strong>{item.name}</strong><small>{item.desc}</small>
          </button>)}
        </nav>
        <div className="discoveryHubContent">
          {discoveryTab==='ideas'&&<IdeaReview/>}
          {discoveryTab==='market'&&<MarketDiscovery/>}
          {discoveryTab==='research'&&<ThemeResearch/>}
          {discoveryTab==='structures'&&<SiteStructures/>}
        </div>
        {discoveryTab!=='ideas'&&<div className="discoveryHubNext">
          <span>調査・設計の記録は既存の専門台帳に保持されます。採用する企画の評価・振り分けは共通Idea Memoryへ。</span>
          <button type="button" onClick={()=>navigate('discover','',false,'ideas')}>アイデアストックへ戻る →</button>
        </div>}
      </div>}
      </Suspense>
    </main>
  </div>;
}
