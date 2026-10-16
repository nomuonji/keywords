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

type DiscoveryTool='market'|'research'|'structures';
type View='operations'|'articles'|'sites'|'treasury'|'sources'|'discover';
const legacyDiscoveryViews=['ideas','market','research','structures'];
// Three specialist ledgers remain accessible as supporting evidence, not parallel idea stores.
const discoveryTools:Array<{id:DiscoveryTool;label:string;description:string}>=[
  {id:'market',label:'楽天ランキング観測',description:'商品ジャンル別の外部観測データ'},
  {id:'research',label:'仮説・反証の履歴',description:'市場仮説を疑い、未解決の論点を確認'},
  {id:'structures',label:'サイトのページ設計',description:'採用したサイト案の構造・キーワード'}
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
  const selectedTool=legacy ? (requested==='ideas' ? null : requested) : tab;
  return {
    view:legacy ? 'discover' as View : views.some(item=>item.id===requested) ? requested as View : fallback,
    tool:discoveryTools.some(item=>item.id===selectedTool) ? selectedTool as DiscoveryTool : null,
    projectId:params.get('project')??''
  };
}

export function App(){
  const initial=readLocation();
  const [view,setView]=useState<View>(initial.view);
  const [discoveryTool,setDiscoveryTool]=useState<DiscoveryTool|null>(initial.tool);
  const [projectId,setProjectId]=useState(initial.projectId);
  const navigate=(next:View,nextProjectId=projectId,replace=false,nextTool=discoveryTool)=>{
    const params=new URLSearchParams();
    if(next!=='operations')params.set('view',next);
    if(next==='discover' && nextTool)params.set('tab',nextTool);
    if(nextProjectId)params.set('project',nextProjectId);
    const url=`${window.location.pathname}${params.size?`?${params}`:''}`;
    window.history[replace?'replaceState':'pushState']({},'',url);
    setView(next);setProjectId(nextProjectId);setDiscoveryTool(nextTool);
  };
  useEffect(()=>{const onPop=()=>{const next=readLocation();setView(next.view);setProjectId(next.projectId);setDiscoveryTool(next.tool)};window.addEventListener('popstate',onPop);return()=>window.removeEventListener('popstate',onPop)},[]);
  return <div className="coreShell">
    <a className="skipLink" href="#main-content">本文へ移動</a>
    <header className="coreTopbar">
      <button className="coreBrand" onClick={()=>navigate('operations','')} aria-label="今日の運用へ"><span/>KEYWORDS</button>
      <nav className="coreNav" aria-label="メインナビゲーション">{views.map(item=><button key={item.id} className={view===item.id?'active':''} aria-current={view===item.id?'page':undefined} onClick={()=>navigate(item.id,projectId,false,item.id==='discover'?null:discoveryTool)}><b>{item.label}</b><small>{item.hint}</small></button>)}</nav>
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
          <p className="coreEyebrow">DISCOVERY / SINGLE IDEA MEMORY</p>
          <div className="discoveryHubTitle"><div>
            <h1>発見・企画</h1>
            <p>市場で見つけた着想を1つのアイデアストックに集め、用途ごとに振り分けて評価します。</p>
          </div><span className="discoveryHubSource">1 IDEA DB <b>→</b> 7+ OUTLETS</span></div>
        </div>
        {discoveryTool ? <>
          <div className="discoveryToolReturn">
            <button type="button" onClick={()=>navigate('discover','',false,null)}>← アイデア一覧に戻る</button>
            <div><strong>{discoveryTools.find(item=>item.id===discoveryTool)?.label}</strong>
              <small>専門台帳の原データを参照中。企画の採否・出口別評価はアイデア一覧で管理します。</small>
            </div>
          </div>
          <div className="discoveryHubContent">
            {discoveryTool==='market'&&<MarketDiscovery/>}
            {discoveryTool==='research'&&<ThemeResearch/>}
            {discoveryTool==='structures'&&<SiteStructures/>}
          </div>
        </> : <>
          <details className="discoveryEvidenceTools">
            <summary><span>必要に応じて調査資料・詳細設計を開く</span>
              <small>市場データ・仮説の反証・サイト構造は別のアイデア一覧ではありません</small>
            </summary>
            <div className="discoveryEvidenceOptions">
              {discoveryTools.map(item=><button key={item.id} type="button"
                onClick={()=>navigate('discover','',false,item.id)}>
                <strong>{item.label}</strong><small>{item.description}</small><span aria-hidden="true">↗</span>
              </button>)}
            </div>
          </details>
          <div className="discoveryHubContent"><IdeaReview/></div>
        </>}
      </div>}
      </Suspense>
    </main>
  </div>;
}
