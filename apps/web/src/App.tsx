import { useEffect, useState } from 'react';
import { OperationsOverview } from './OperationsOverview';
import { ArticlesOverview } from './ArticlesOverview';
import { SitesOverview } from './SitesOverview';
import { KeywordTreasury } from './KeywordTreasury';

type View='operations'|'articles'|'sites'|'treasury';
const views:Array<{id:View;label:string;hint:string}>=[
  {id:'operations',label:'今日',hint:'優先順位・停止理由'},
  {id:'sites',label:'サイト',hint:'状態・設定'},
  {id:'articles',label:'記事',hint:'管理・検証・成果'},
  {id:'treasury',label:'お宝KW',hint:'共有ストック'}
];

function readLocation(){
  const params=new URLSearchParams(window.location.search);
  const requested=params.get('view');
  return {
    view:views.some(item=>item.id===requested)?requested as View:'operations' as View,
    projectId:params.get('project')??''
  };
}

export function App(){
  const initial=readLocation();
  const [view,setView]=useState<View>(initial.view);
  const [projectId,setProjectId]=useState(initial.projectId);
  const navigate=(next:View,nextProjectId=projectId,replace=false)=>{
    const params=new URLSearchParams();
    if(next!=='operations')params.set('view',next);
    if(nextProjectId)params.set('project',nextProjectId);
    const url=`${window.location.pathname}${params.size?`?${params}`:''}`;
    window.history[replace?'replaceState':'pushState']({},'',url);
    setView(next);setProjectId(nextProjectId);
  };
  useEffect(()=>{const onPop=()=>{const next=readLocation();setView(next.view);setProjectId(next.projectId)};window.addEventListener('popstate',onPop);return()=>window.removeEventListener('popstate',onPop)},[]);
  return <div className="coreShell">
    <a className="skipLink" href="#main-content">本文へ移動</a>
    <header className="coreTopbar">
      <button className="coreBrand" onClick={()=>navigate('operations','')} aria-label="今日の運用へ"><span/>KEYWORDS</button>
      <nav className="coreNav" aria-label="メインナビゲーション">{views.map(item=><button key={item.id} className={view===item.id?'active':''} aria-current={view===item.id?'page':undefined} onClick={()=>navigate(item.id)}><b>{item.label}</b><small>{item.hint}</small></button>)}</nav>
      <div className="coreTopMeta"><span className="stateDot live"/>local workspace</div>
    </header>
    <main className="coreMain" id="main-content">
      {view==='operations'&&<OperationsOverview focusedProjectId={projectId} onFocusProject={id=>navigate('operations',id,true)} onOpenArticles={id=>navigate('articles',id??projectId)} onOpenSites={id=>navigate('sites',id??projectId)}/>}
      {view==='articles'&&<ArticlesOverview focusedProjectId={projectId} onFocusProject={id=>navigate('articles',id,true)} onOpenOperations={id=>navigate('operations',id)}/>}
      {view==='sites'&&<SitesOverview focusedProjectId={projectId} onClearProject={()=>navigate('sites','',true)} onOpenArticles={id=>navigate('articles',id)} onOpenOperations={id=>navigate('operations',id)}/>}
      {view==='treasury'&&<KeywordTreasury/>}
    </main>
  </div>;
}
