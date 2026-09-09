import { useEffect, useRef, useState } from 'react';
import { api } from './api';

type Artifact={id:string;operationId:string;projectId:string;projectName:string;pageId?:string|null;articleId:string;title:string;path:string;contentSha256:string;validatorStatus:string;buildStatus:string;verifiedAt?:string|null;updatedAt:string;revisionCount:number;validatorResult?:{failedChecks?:string[]}|null};
type Attention={operationId:string;projectId:string;projectName:string;status:string;blocker?:string|null;blockerClass?:string|null;objective:string;updatedAt:string};
type Executor={id:string;status:string;runnable:boolean;failureClass?:string|null;cooldownUntil?:string|null;lastError?:string|null;lastSeenAt?:string|null};
type ArticleDashboard={generatedAt:string;complete:Artifact[];inProgress:Artifact[];attention:Attention[];executors:Executor[]};
type Portfolio={articles:ArticleDashboard};
const when=(value?:string|null)=>value?new Date(value).toLocaleString():'—';

export function ArticlesOverview(){
 const [data,setData]=useState<ArticleDashboard|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);const alive=useRef(true);
 const load=async()=>{try{const row=await api<Portfolio>('/portfolio');if(!alive.current)return;setData(row.articles);setError('')}catch(e){if(alive.current)setError(String(e))}finally{if(alive.current)setLoading(false)}};
 useEffect(()=>{alive.current=true;void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load()},15000);const visible=()=>{if(document.visibilityState==='visible')void load()};document.addEventListener('visibilitychange',visible);return()=>{alive.current=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible)}},[]);
 if(loading&&!data)return <section className="empty"><h1>記事を読み込み中…</h1></section>;
 return <div className="productStack" style={{padding:'28px',maxWidth:1180,margin:'0 auto'}}>
  <header className="productHeader"><div><p className="eyebrow">HEADLESS CONTENT OPERATIONS</p><h1>記事</h1><p>完成した本文、制作中の本文、要判断だけを表示します。</p></div><div className="agent"><span className="pulse"/>worker / SQL 正本</div></header>
  {error&&<div className="error globalError" role="alert">{error}<button onClick={()=>void load()}>再試行</button></div>}
  <section className="panel"><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:16}}><div><p className="eyebrow">DONE</p><h2>完成記事</h2></div><small>{data?.complete.length??0}件</small></div>
   <div style={{display:'grid',gap:12}}>{data?.complete.length?data.complete.map(a=><article className="card" key={a.id}><div style={{display:'flex',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}><div><h3>{a.title}</h3><p>{a.projectName} · <code>{a.path}</code></p></div><strong>検証済み</strong></div><p>validator: {a.validatorStatus} / build: {a.buildStatus} / verified: {when(a.verifiedAt)}</p><small>SHA {a.contentSha256.slice(0,12)}…</small></article>):<p>まだ完成記事はありません。</p>}</div>
  </section>
  <section className="panel"><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:16}}><div><p className="eyebrow">IN PROGRESS</p><h2>制作中</h2></div><small>{data?.inProgress.length??0}件</small></div>
   <div style={{display:'grid',gap:12}}>{data?.inProgress.length?data.inProgress.map(a=><article className="card" key={a.id}><h3>{a.title}</h3><p>{a.projectName} · <code>{a.path}</code></p><p>validator: <b>{a.validatorStatus}</b> / build: <b>{a.buildStatus}</b> / revision: {a.revisionCount}</p>{a.validatorResult?.failedChecks?.length?<p>未通過: {a.validatorResult.failedChecks.join(' / ')}</p>:null}<small>更新 {when(a.updatedAt)}</small></article>):<p>制作中の記事はありません。</p>}</div>
  </section>
  <section className="panel"><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:16}}><div><p className="eyebrow">ATTENTION</p><h2>要判断・停止理由</h2></div><small>{data?.attention.length??0}件</small></div>
   <div style={{display:'grid',gap:12}}>{data?.attention.length?data.attention.map(a=><article className="card" key={`${a.operationId}:${a.projectId}`}><div style={{display:'flex',justifyContent:'space-between',gap:16}}><h3>{a.projectName}</h3><strong>{a.blockerClass??a.status}</strong></div><p>{a.blocker||a.objective}</p><small>更新 {when(a.updatedAt)}</small></article>):<p>人間判断が必要な項目はありません。</p>}</div>
  </section>
  <section className="panel"><p className="eyebrow">RUNTIME</p><h2>実行基盤</h2><div style={{display:'grid',gap:10}}>{data?.executors.length?data.executors.map(e=><div className="card" key={e.id}><div style={{display:'flex',justifyContent:'space-between',gap:12}}><b>{e.id}</b><strong>{e.status}</strong></div>{e.failureClass?<p>{e.failureClass}{e.cooldownUntil?` · 再試行 ${when(e.cooldownUntil)}`:''}</p>:<p>実行可能: {e.runnable?'yes':'no'}</p>}{e.lastError?<small>{e.lastError}</small>:null}</div>):<p>executor が登録されていません。</p>}</div></section>
  <small>最終同期 {when(data?.generatedAt)}</small>
 </div>;
}
