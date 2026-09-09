import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

type AutoProject={id:string;name:string;domain?:string|null;control:{enabled:boolean;autoPublish:boolean};state:{status:string;stage:string;summary?:string|null;lastTickAt?:string|null};activeOperation:{id:string;status:string;objective:string;workSummary?:string|null;blocker?:string|null;nextAction?:string|null;updatedAt:string}|null;executor:{id:string;status:string;connected:boolean}|null;openReviews:number};
type AutoPortfolio={totals:{projects:number;enabled:number;executing:number;queued:number;attention:number;activeOperations:number;connectedAgents:number};projects:AutoProject[]};
type KeywordChoice={id:string;projectId:string;projectName:string;keyword:string;verdict:string;reason?:string|null;demand?:number|null;searchIntent?:string|null;createdAt:string};
type Article={id:string;projectName:string;title:string;validatorStatus:string;buildStatus:string;verifiedAt?:string|null;updatedAt:string};
type Portfolio={keywordChoices?:KeywordChoice[];articles?:{complete?:Article[];inProgress?:Article[]}};
type Outcome={id:string;projectId:string;status:string;targetUrl?:string|null;hypothesis?:string|null;publishedAt?:string|null;evaluationDueAt?:string|null;metrics?:Record<string,unknown>;nextAction?:string|null;updatedAt:string};
type Operations={outcomes?:Outcome[]};

const when=(value?:string|null)=>value?new Date(value).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const stageLabel:Record<string,string>={planning:'選定中',queued_for_agent:'Agent待ち',executing:'実行中',quality_gate:'検証中',delivery_ready:'公開待ち',observing:'評価中',decision_wait:'判断待ち',blocked:'停止',attention:'要対応',idle:'待機'};
const verdictLabel:Record<string,string>={shortlisted:'採用',rejected:'見送り',hold:'保留',research_more:'追加調査'};
const outcomeLabel:Record<string,string>={pending:'評価待ち',improved:'改善',regressed:'悪化',inconclusive:'未判定',unmeasurable:'計測不能'};

export function OperationsOverview({onOpenArticles}:{onOpenArticles:()=>void}){
  const [auto,setAuto]=useState<AutoPortfolio|null>(null),[portfolio,setPortfolio]=useState<Portfolio|null>(null),[ops,setOps]=useState<Operations|null>(null),[query,setQuery]=useState(''),[error,setError]=useState('');
  const load=async()=>{try{const [a,p,o]=await Promise.all([api<AutoPortfolio>('/autopilot/portfolio'),api<Portfolio>('/portfolio'),api<Operations>('/operations/context')]);setAuto(a);setPortfolio(p);setOps(o);setError('')}catch(e){setError(String(e))}};
  useEffect(()=>{void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load()},10000);return()=>clearInterval(timer)},[]);
  const active=useMemo(()=>(auto?.projects??[]).filter(p=>p.activeOperation||p.executor?.connected||['attention','blocked','running'].includes(p.state.status)).filter(p=>`${p.name} ${p.domain??''} ${p.activeOperation?.objective??''}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>Number(Boolean(b.executor?.connected))-Number(Boolean(a.executor?.connected))||Date.parse(b.activeOperation?.updatedAt||b.state.lastTickAt||'')-Date.parse(a.activeOperation?.updatedAt||a.state.lastTickAt||'')).slice(0,12),[auto,query]);
  const choices=useMemo(()=>(portfolio?.keywordChoices??[]).filter(x=>`${x.projectName} ${x.keyword} ${x.reason??''}`.toLowerCase().includes(query.toLowerCase())).slice(0,12),[portfolio,query]);
  const recentArticles=useMemo(()=>[...(portfolio?.articles?.inProgress??[]),...(portfolio?.articles?.complete??[])].sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).filter(x=>`${x.projectName} ${x.title}`.toLowerCase().includes(query.toLowerCase())).slice(0,10),[portfolio,query]);
  const outcomes=useMemo(()=>(ops?.outcomes??[]).filter(x=>`${x.status} ${x.targetUrl??''} ${x.hypothesis??''}`.toLowerCase().includes(query.toLowerCase())).slice(0,10),[ops,query]);
  return <div className="corePage">
    <div className="coreTitleRow"><div><p className="coreEyebrow">OPERATIONS</p><h1>運用</h1><p>Agentの判断から公開後評価まで、必要な流れだけを追います。</p></div><div className="coreLive"><span/>10秒更新</div></div>
    {error&&<div className="coreError">{error}<button onClick={()=>void load()}>再試行</button></div>}
    <div className="coreStats">
      <div><span>実行中</span><strong>{auto?.totals.executing??0}</strong><small>Agentが処理中</small></div>
      <div><span>待機</span><strong>{auto?.totals.queued??0}</strong><small>次に実行</small></div>
      <div><span>要対応</span><strong>{auto?.totals.attention??0}</strong><small>判断・停止</small></div>
      <div><span>接続Agent</span><strong>{auto?.totals.connectedAgents??0}</strong><small>稼働executor</small></div>
    </div>
    <div className="coreToolbar"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="サイト・キーワード・記事を検索"/><span>{auto?.totals.projects??0} sites</span></div>

    <section className="coreSection"><div className="coreSectionHead"><div><p className="coreEyebrow">NOW</p><h2>Agentが今やっていること</h2></div><small>{active.length}件表示</small></div>
      <div className="coreList">{active.length?active.map(p=><div className="activityRow" key={p.id}><span className={`stateDot ${p.executor?.connected?'live':p.activeOperation?.status==='blocked'?'bad':'quiet'}`}/><div className="activityMain"><div className="activityTop"><b>{p.name}</b><span>{stageLabel[p.state.stage]||p.activeOperation?.status||p.state.status}</span></div><p>{p.activeOperation?.objective||p.state.summary||'次の作業を選定中'}</p>{p.activeOperation?.blocker?<small className="badText">停止理由: {p.activeOperation.blocker}</small>:<small>{p.activeOperation?.nextAction||`更新 ${when(p.activeOperation?.updatedAt||p.state.lastTickAt)}`}</small>}</div></div>):<p className="coreEmpty">現在進行中の作業はありません。</p>}</div>
    </section>

    <div className="coreSplit">
      <section className="coreSection"><div className="coreSectionHead"><div><p className="coreEyebrow">KEYWORD DECISIONS</p><h2>キーワード選定</h2></div><small>採用理由まで表示</small></div>
        <div className="decisionList">{choices.length?choices.map(x=><div className="decisionRow" key={x.id}><div><b>{x.keyword}</b><small>{x.projectName}{x.demand!=null?` · demand ${x.demand}`:''}</small></div><span className={`decision ${x.verdict}`}>{verdictLabel[x.verdict]||x.verdict}</span><p>{x.reason||'理由の記録なし'}</p></div>):<p className="coreEmpty">まだ選定記録はありません。</p>}</div>
      </section>
      <section className="coreSection"><div className="coreSectionHead"><div><p className="coreEyebrow">ARTICLE FLOW</p><h2>最近の記事</h2></div><button className="textButton" onClick={onOpenArticles}>記事一覧 →</button></div>
        <div className="compactRows">{recentArticles.length?recentArticles.map(a=><div className="compactRow" key={a.id}><div><b>{a.title}</b><small>{a.projectName}</small></div><span className={a.verifiedAt?'goodPill':'workPill'}>{a.verifiedAt?'検証済み':'制作中'}</span></div>):<p className="coreEmpty">記事成果物はまだありません。</p>}</div>
      </section>
    </div>

    <section className="coreSection"><div className="coreSectionHead"><div><p className="coreEyebrow">AFTER PUBLISH</p><h2>公開後の評価</h2></div><small>結果が出たものを優先</small></div>
      <div className="outcomeGrid">{outcomes.length?outcomes.map(o=><article className={`outcomeCard ${o.status}`} key={o.id}><div><span className="outcomeStatus">{outcomeLabel[o.status]||o.status}</span><small>{when(o.updatedAt)}</small></div><b>{o.targetUrl||o.hypothesis||'公開施策'}</b><p>{o.nextAction||o.hypothesis||'次の評価条件を待っています。'}</p>{o.metrics&&Object.keys(o.metrics).length>0?<code>{Object.entries(o.metrics).slice(0,4).map(([k,v])=>`${k}: ${String(v)}`).join(' · ')}</code>:null}</article>):<p className="coreEmpty">公開後評価はまだありません。</p>}</div>
    </section>
  </div>;
}
