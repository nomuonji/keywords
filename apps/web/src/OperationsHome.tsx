import { useEffect, useState } from 'react';
import { api } from './api';

type Gate={decision:'publish'|'revise'|'reject';score:number;evidenceScore:number;commodityRisk:number;informationGain:number;factCount:number;sourceCount:number;reasons:string[]};
type QueueItem={id:string;title:string;planMode:string;status:string;updatedAt:string;gate:Gate|null};
type Event={id:string;kind:string;severity:string;payload:Record<string,unknown>;createdAt:string};
type Operation={id:string;objective:string;status:string;updatedAt:string;projects:Array<{projectId:string;name:string;status:string;work?:{status:string;summary?:string|null;nextAction?:string|null}|null}>};
type Status={
 generatedAt:string;project:{id:string;name:string;domain?:string|null};
 control:{enabled:boolean;autoApprove:boolean;autoPublish:boolean;cadenceMinutes:number;maxDailyNewArticles:number;maxDailyUpdates:number;minEvidenceScore:number;maxCommodityRisk:number;minInformationGain:number;minPublicationScore:number};
 operationControl:{paused:boolean;reason?:string|null};
 state:{status:string;stage:string;operationId?:string|null;summary?:string|null;lastTickAt?:string|null;nextTickAt?:string|null;lastError?:string|null};
 pipeline:{discovery:number;research:number;gate:number;ready:number;delivery:number;observing:number};
 activeOperation:Operation|null;
 executor:{id:string;status:string;connected:boolean;lastSeenAt:string;leaseExpiresAt?:string|null}|null;
 manualReviews:Array<{id:string;title:string;target_type:string;created_at:string}>;
 qualityQueue:QueueItem[];
 handoffs:Array<{id:string;page_id:string;status:string;published_at?:string|null;next_observation_at?:string|null;created_at:string}>;
 recentEvents:Event[];
 publication:{newArticle:{used:number;limit:number;remaining:number};update:{used:number;limit:number;remaining:number}};
};

const when=(value?:string|null)=>value?new Date(value).toLocaleString():'—';
const stageLabel:Record<string,string>={disabled:'停止',paused:'緊急停止',idle:'待機',planning:'次の仕事を選定',queued_for_agent:'Agent待ち',executing:'Agent実行中',quality_gate:'品質判定',approved:'承認済み',revision:'再調査・修正',rejected:'棄却',delivery_ready:'公開搬送待ち',throttled:'上限制御',decision_wait:'判定待ち',manual_boundary:'安全境界',error:'エラー'};
const gateTone=(decision:string)=>decision==='publish'?'ok':decision==='reject'?'bad':'review';

export function OperationsHome({projectId,onChanged}:{projectId:string;onChanged:()=>void}){
 const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState('');
 const load=async()=>{try{setStatus(await api<Status>(`/projects/${projectId}/autopilot`));setError('')}catch(e){setError(String(e))}};
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),5000);return()=>clearInterval(timer)},[projectId]);
 async function configure(enabled:boolean){try{setBusy('autopilot');await api(`/projects/${projectId}/autopilot/configure`,{method:'POST',body:JSON.stringify({enabled})});await load();onChanged()}catch(e){setError(String(e))}finally{setBusy('')}}
 async function pause(paused:boolean){try{setBusy('pause');await api(`/operations/projects/${projectId}/pause`,{method:'POST',body:JSON.stringify({paused,reason:paused?'Emergency stop from autopilot monitor':undefined})});await load()}catch(e){setError(String(e))}finally{setBusy('')}}
 async function tick(){try{setBusy('tick');await api(`/projects/${projectId}/autopilot/tick`,{method:'POST',body:'{}'});await load()}catch(e){setError(String(e))}finally{setBusy('')}}
 const c=status?.control,s=status?.state,p=status?.pipeline;
 const pipeline=[['探索',p?.discovery??0],['調査・実行',p?.research??0],['品質ゲート',p?.gate??0],['公開可能',p?.ready??0],['搬送中',p?.delivery??0],['観測中',p?.observing??0]];
 return <div className="productStack">{error&&<div className="error">{error}</div>}
  <section className="homeHero"><div><p className="eyebrow">AUTOPILOT / LIVE</p><h2>{c?.enabled?'自律運転中':'自律運転は停止中'}</h2><p>{s?.summary||'状態を読み込み中です。'}</p><div className="row"><span className={`status ${s?.status||'idle'}`}>{stageLabel[s?.stage||'idle']||s?.stage||'idle'}</span><small>最終判定 {when(s?.lastTickAt)} · 次回 {when(s?.nextTickAt)}</small></div></div>
   <div className="stack"><span className="sourceType">Agent {status?.executor?.connected?'ONLINE':'OFFLINE'}{status?.executor?` · ${status.executor.id}`:''}</span><div className="row"><button className={c?.enabled?'':'primaryAction'} disabled={!!busy} onClick={()=>void configure(!c?.enabled)}>{busy==='autopilot'?'更新中…':c?.enabled?'Autopilot OFF':'Autopilot ON'}</button><button disabled={!!busy} onClick={()=>void pause(!status?.operationControl.paused)}>{status?.operationControl.paused?'緊急停止を解除':'緊急停止'}</button></div><button disabled={!!busy||!c?.enabled} onClick={()=>void tick()}>{busy==='tick'?'判定中…':'今すぐ再評価'}</button></div>
  </section>

  <section className="panel"><div className="panelHead"><div><p className="eyebrow">PIPELINE</p><h2>今どこで何件動いているか</h2></div><span>5秒ごとに更新</span></div><div className="metricGrid">{pipeline.map(([label,value])=><div className="metricCard" key={String(label)}><small>{label}</small><strong>{value}</strong></div>)}</div></section>

  <div className="twoColumn"><section className="panel"><div className="panelHead"><div><p className="eyebrow">NOW</p><h2>現在のOperation</h2></div>{status?.activeOperation&&<span className={`status ${status.activeOperation.status}`}>{status.activeOperation.status}</span>}</div>
   {status?.activeOperation?<div className="list"><div className="task"><div><b>{status.activeOperation.objective}</b><small>Operation {status.activeOperation.id}</small></div></div>{status.activeOperation.projects.map(item=><div className="task" key={item.projectId}><span className={`status ${item.work?.status||item.status}`}>{item.work?.status||item.status}</span><div><b>{item.name}</b><small>{item.work?.summary||item.work?.nextAction||'Agentが共有セッションで処理中'}</small></div></div>)}</div>:<div className="hint">現在のOperationはありません。必要条件が満たされればAutopilotが次を作成します。</div>}
   {s?.lastError&&<div className="error">{s.lastError}</div>}
  </section>
  <section className="panel"><div className="panelHead"><div><p className="eyebrow">EXECUTOR</p><h2>Agent実行状態</h2></div><span className={`status ${status?.executor?.connected?'done':'blocked'}`}>{status?.executor?.connected?'connected':'offline'}</span></div>
   {status?.executor?<div className="list"><div className="task"><div><b>{status.executor.id}</b><small>{status.executor.status} · last seen {when(status.executor.lastSeenAt)}</small><small>lease {when(status.executor.leaseExpiresAt)}</small></div></div></div>:<div className="hint">Persistent Agent runnerがまだ接続されていません。</div>}
   <div className="hint">通常運転では人間の操作は不要です。OFFLINEやERRORだけを監視してください。</div>
  </section></div>

  <section className="panel"><div className="panelHead"><div><p className="eyebrow">QUALITY GATE</p><h2>記事候補の自動判定</h2></div><span>{status?.qualityQueue.length??0}</span></div><div className="list">{status?.qualityQueue.map(item=><div className="task" key={item.id}><span className={`status ${item.gate?gateTone(item.gate.decision):'review'}`}>{item.gate?.decision||'pending'}</span><div><b>{item.title}</b><small>{item.planMode} · {item.status}</small>{item.gate&&<small>公開 {item.gate.score}/100 · Evidence {item.gate.evidenceScore} · Commodity {item.gate.commodityRisk}/5 · Gain {item.gate.informationGain} · Facts {item.gate.factCount}</small>}{item.gate?.reasons?.length?<small>{item.gate.reasons.slice(0,2).join(' / ')}</small>:null}</div></div>)}{!status?.qualityQueue.length&&<div className="hint">現在、判定待ちの記事企画はありません。</div>}</div></section>

  <div className="twoColumn"><section className="panel"><div className="panelHead"><div><p className="eyebrow">DELIVERY / OBSERVATION</p><h2>公開と成果観測</h2></div></div><div className="list">{status?.handoffs.slice(0,8).map(h=><div className="task" key={h.id}><span className={`status ${h.status}`}>{h.status}</span><div><b>Handoff {h.id.slice(0,8)}</b><small>Page {h.page_id.slice(0,8)} · 作成 {when(h.created_at)}</small><small>{h.published_at?`公開 ${when(h.published_at)}`:h.next_observation_at?`次回観測 ${when(h.next_observation_at)}`:'Blog Agentへの搬送待ち'}</small></div></div>)}{!status?.handoffs.length&&<div className="hint">handoffはまだありません。</div>}</div></section>
  <section className="panel"><div className="panelHead"><div><p className="eyebrow">THROTTLE</p><h2>24時間の量産上限</h2></div></div><div className="list"><div className="task"><div><b>新規記事 {status?.publication.newArticle.used??0} / {status?.publication.newArticle.limit??c?.maxDailyNewArticles??0}</b><small>残り {status?.publication.newArticle.remaining??0}</small></div></div><div className="task"><div><b>大幅更新 {status?.publication.update.used??0} / {status?.publication.update.limit??c?.maxDailyUpdates??0}</b><small>残り {status?.publication.update.remaining??0}</small></div></div><div className="hint">公開ゲート {c?.minPublicationScore??80}+ / Evidence {c?.minEvidenceScore??50}+ / Commodity ≤ {c?.maxCommodityRisk??3} / Gain {c?.minInformationGain??2}+</div></div></section></div>

  <div className="twoColumn"><section className="panel"><div className="panelHead"><div><p className="eyebrow">EVENT STREAM</p><h2>直近の動き</h2></div></div><div className="list">{status?.recentEvents.slice(0,12).map(event=><div className="event" key={event.id}><span className={event.severity==='error'?'bad':event.severity==='warning'?'warn':'ok'}/><div><b>{event.kind}</b><small>{when(event.createdAt)}</small></div></div>)}{!status?.recentEvents.length&&<div className="hint">イベントはまだありません。</div>}</div></section>
  <section className="panel"><div className="panelHead"><div><p className="eyebrow">SAFETY BOUNDARY</p><h2>人間に残す例外</h2></div><span>{status?.manualReviews.length??0}</span></div><div className="list">{status?.manualReviews.map(review=><div className="task" key={review.id}><span className="status review">manual</span><div><b>{review.title}</b><small>{review.target_type} · {when(review.created_at)}</small></div></div>)}{!status?.manualReviews.length&&<div className="hint">記事運用を止める人間判断はありません。削除・URL移動・DNS・policy有効化など、記事量産外の破壊的変更だけをここに残します。</div>}</div></section></div>
 </div>;
}
