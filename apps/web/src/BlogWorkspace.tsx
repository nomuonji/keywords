import { useEffect, useState } from 'react';
import { api } from './api';
type Handoff={id:string;page_id:string;status:string;next_observation_at:string|null};
type Brief={page_id:string;packet:{reader_task:string;direct_answer:string;unique_value:string;editorial_owner:string;value_source_ids:string[];demand_source_ids:string[];existing_coverage:string;claim_source_map:Array<{claim:string;source_id:string;locator:string}>}};
type State={binding:{siteId:string;origin:string;observedAt:string;coverage:Record<string,unknown>}|null;handoffs:Handoff[];briefs:Brief[];next:Array<{title:string;reason:string}>};
const label:Record<string,string>={exported:'Blog受け渡し待ち',accepted:'Blog作業中',blocked:'問題の解消待ち',local_verified:'ローカル検証済み・公開待ち',published:'公開確認済み',observing:'観測中',evaluated:'評価記録済み'};
export function BlogWorkspace({projectId}:{projectId:string}){
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=()=>api<State>(`/projects/${projectId}/blog`).then(setState);
 useEffect(()=>{let active=true;api<State>(`/projects/${projectId}/blog`).then(x=>{if(active)setState(x)}).catch(e=>{if(active)setError(String(e))});return()=>{active=false}},[projectId]);
 async function importFile(file:File){setBusy(true);setError('');try{await api(`/projects/${projectId}/blog/importContext`,{method:'POST',body:JSON.stringify({snapshot:JSON.parse(await file.text())})});await load()}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function approve(pageId:string){setBusy(true);setError('');try{await api(`/projects/${projectId}/pages/${pageId}/review`,{method:'POST',body:JSON.stringify({verdict:'approved',reason:'Blog連携の追加価値・根拠と企画を確認'})});await load()}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function download(pageId:string){setBusy(true);setError('');try{const data=await api(`/projects/${projectId}/blog/export`,{method:'POST',body:JSON.stringify({pageId})});const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`blog-${pageId}.json`;a.click();URL.revokeObjectURL(url);await load()}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <section className="panel"><h2>Blogとの連携</h2><p>ローカルの記事一覧を取り込み、根拠を確認した企画をBlogへ渡します。企画の承認は公開の許可ではありません。</p>
 {error&&<p role="alert" className="error">{error}</p>}
 <label>サイト現状ファイルを選択 <input type="file" accept="application/json,.json" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f)}}/></label>
 {state?.binding&&<p>{state.binding.siteId} · {state.binding.origin}<br/>最終取得: {new Date(state.binding.observedAt).toLocaleString()}</p>}
 {state?.next.map((n,i)=><p key={i}><b>{n.title}</b> — {n.reason}</p>)}
 {state?.briefs.map(b=><details key={b.page_id}><summary>{b.packet.reader_task}</summary><p><b>直接の回答:</b> {b.packet.direct_answer}</p><p><b>追加する価値:</b> {b.packet.unique_value}</p><p><b>既存記事との関係:</b> {b.packet.existing_coverage}</p><p>編集責任: {b.packet.editorial_owner}</p><p>材料の証拠: {b.packet.value_source_ids.join(', ')}</p><p>検索需要の証拠: {b.packet.demand_source_ids.join(', ')}</p>{b.packet.claim_source_map.map((c,i)=><p key={i}>{c.claim}<br/>{c.source_id} · {c.locator}</p>)}<p>詳細な原典はコンテンツ計画のEvidenceで確認してください。</p><button disabled={busy} onClick={()=>void approve(b.page_id)}>根拠を確認して企画を承認</button> <button disabled={busy} onClick={()=>void download(b.page_id)}>承認済み企画をダウンロード</button></details>)}
 <h3>受け渡した企画</h3>{state?.handoffs.map(h=><p key={h.id}>{label[h.status]||h.status} · {h.id}{h.next_observation_at&&<> / 次回観測: {new Date(h.next_observation_at).toLocaleDateString()}</>}</p>)}
 {!state?.handoffs.length&&<p className="hint">まだ企画の受け渡しはありません。</p>}</section>;
}
