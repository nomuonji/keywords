import { useEffect, useRef, useState } from 'react';
import { api } from './api';

type Review={id:string;projectId:string;targetType:string;targetId?:string|null;title:string;question?:string|null;options:string[];createdAt:string};
const optionLabel:Record<string,string>={approved:'承認',rejected:'見送り',needs_edit:'修正が必要',active:'有効化',continue:'続行',stop:'停止',review_failed_checks:'未通過項目を確認',stop_article:'記事作業を停止'};

export function ReviewPanel({projectId,projectName,onClose,onResolved}:{projectId:string;projectName:string;onClose:()=>void;onResolved:()=>void}){
  const [items,setItems]=useState<Review[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(''),[reasons,setReasons]=useState<Record<string,string>>({}),[pending,setPending]=useState<Record<string,string>>({});
  const panelRef=useRef<HTMLElement>(null);
  const load=async()=>{try{setLoading(true);setItems(await api<Review[]>(`/projects/${encodeURIComponent(projectId)}/reviews?status=open`));setError('')}catch(e){setError(String(e))}finally{setLoading(false)}};
  useEffect(()=>{void load();requestAnimationFrame(()=>{panelRef.current?.scrollIntoView({behavior:'smooth',block:'start'});panelRef.current?.focus()})},[projectId]);
  const resolve=async(review:Review,resolution:string)=>{setBusy(review.id);try{await api(`/projects/${encodeURIComponent(projectId)}/reviews/${encodeURIComponent(review.id)}/resolve`,{method:'POST',body:JSON.stringify({resolution,reason:reasons[review.id]?.trim()||undefined})});setItems(current=>current.filter(item=>item.id!==review.id));setError('');onResolved()}catch(e){setError(String(e))}finally{setBusy('')}};
  return <aside className="reviewPanel" aria-labelledby="review-panel-title" ref={panelRef} tabIndex={-1}>
    <div className="reviewPanelHead"><div><p className="coreEyebrow">HUMAN REVIEW</p><h2 id="review-panel-title">{projectName}の判断</h2><p>選択は意思決定として記録され、停止中の作業に反映されます。</p></div><button className="panelClose" onClick={onClose} aria-label="判断パネルを閉じる">閉じる</button></div>
    {error&&<div className="coreError"><span>{error}</span><button onClick={()=>void load()}>再試行</button></div>}
    {loading&&<div className="reviewSkeleton"><span/><span/></div>}
    {!loading&&items.map(review=>{const selected=pending[review.id];return <article className="reviewItem" key={review.id}><div><span className="reviewTarget">{review.targetType}</span><h3>{review.title}</h3><p>{review.question||'この作業をどの状態に進めるか選んでください。'}</p></div><label><span>判断理由（任意）</span><textarea value={reasons[review.id]??''} onChange={e=>setReasons(current=>({...current,[review.id]:e.target.value}))} placeholder="後から判断を再利用できる具体的な理由"/></label><div className="reviewOptions">{review.options.map(option=>{const style=['rejected','stop','stop_article'].includes(option)?'rejectOption':['needs_edit','review_failed_checks'].includes(option)?'reviseOption':'approveOption';return <button disabled={busy===review.id} aria-pressed={selected===option} className={`${style} ${selected===option?'selected':''}`} key={option} onClick={()=>setPending(current=>({...current,[review.id]:option}))}>{optionLabel[option]||option}</button>})}{selected&&<div className="reviewConfirm" role="status"><span>「{optionLabel[selected]||selected}」を選択中</span><button disabled={busy===review.id} onClick={()=>void resolve(review,selected)}>{busy===review.id?'記録中…':'この判断を記録'}</button><button className="cancelDecision" disabled={busy===review.id} onClick={()=>setPending(current=>{const next={...current};delete next[review.id];return next})}>選び直す</button></div>}</div></article>})}
    {!loading&&!items.length&&<div className="composedEmpty"><strong>未解決の判断はありません</strong><p>作業状態を更新しました。</p></div>}
  </aside>;
}
