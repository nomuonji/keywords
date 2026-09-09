import { useState } from 'react';
import { OperationsOverview } from './OperationsOverview';
import { ArticlesOverview } from './ArticlesOverview';
import { SitesOverview } from './SitesOverview';

type View='operations'|'articles'|'sites';
const views:Array<{id:View;label:string;hint:string}>=[
  {id:'operations',label:'運用',hint:'Agent・選定・評価'},
  {id:'articles',label:'記事',hint:'制作・公開・成果'},
  {id:'sites',label:'サイト',hint:'状態・設定'}
];

export function App(){
  const [view,setView]=useState<View>('operations');
  return <div className="coreShell">
    <header className="coreTopbar">
      <button className="coreBrand" onClick={()=>setView('operations')} aria-label="運用トップへ"><span/>KEYWORDS</button>
      <nav className="coreNav" aria-label="メインナビゲーション">{views.map(item=><button key={item.id} className={view===item.id?'active':''} onClick={()=>setView(item.id)}><b>{item.label}</b><small>{item.hint}</small></button>)}</nav>
      <div className="coreTopMeta"><span className="stateDot live"/>headless</div>
    </header>
    <main className="coreMain">
      {view==='operations'&&<OperationsOverview onOpenArticles={()=>setView('articles')}/>} 
      {view==='articles'&&<ArticlesOverview/>}
      {view==='sites'&&<SitesOverview/>}
    </main>
  </div>;
}
