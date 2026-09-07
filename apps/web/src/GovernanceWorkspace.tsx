import { useEffect, useState } from 'react';
import { api } from './api';
import { WorkSessions } from './WorkSessions';
import type { PolicyContext } from './product-types';

export function GovernanceWorkspace({projectId,onChanged}:{projectId:string;onChanged:()=>void}){
 const [policies,setPolicies]=useState<PolicyContext|null>(null),[reason,setReason]=useState<Record<string,string>>({}),[error,setError]=useState(''),[busy,setBusy]=useState('');
 const load=async()=>{try{setPolicies(await api<PolicyContext>(`/projects/${projectId}/policies/context?decisions=30`));setError('')}catch(e){setError(String(e))}};
 useEffect(()=>{void load()},[projectId]);
 async function review(id:string,verdict:'active'|'rejected'){const why=(reason[id]||'').trim();if(verdict==='rejected'&&!why){setError('ポリシー却下には理由が必要です。');return}try{setBusy(id);await api(`/projects/${projectId}/policies/${id}/review`,{method:'POST',body:JSON.stringify({verdict,reason:why||undefined})});await load();onChanged()}catch(e){setError(String(e))}finally{setBusy('')}}
 async function retire(id:string){const why=(reason[id]||'').trim();if(!why){setError('ポリシー停止には理由が必要です。');return}try{setBusy(id);await api(`/projects/${projectId}/policies/${id}/retire`,{method:'POST',body:JSON.stringify({reason:why})});await load();onChanged()}catch(e){setError(String(e))}finally{setBusy('')}}
 return <div className="productStack">{error&&<div className="error">{error}</div>}<WorkSessions projectId={projectId} onChanged={()=>{void load();onChanged()}}/>
  <section className="panel"><div className="panelHead"><div><p className="eyebrow">PROJECT POLICY MEMORY</p><h2>継続ルール</h2></div><span>{policies?.active.length??0} active · {policies?.candidates.length??0} pending</span></div><div className="list">{policies?.active.map(p=><div className="governanceRow" key={p.id}><div><span className="sourceType">{p.scope}</span><b>{p.rule}</b>{p.rationale&&<small>{p.rationale}</small>}</div><div className="governanceActions"><input value={reason[p.id]||''} onChange={e=>setReason(v=>({...v,[p.id]:e.target.value}))} placeholder="停止理由"/><button disabled={!!busy} onClick={()=>void retire(p.id)}>停止</button></div></div>)}{policies?.candidates.map(p=><div className="governanceRow" key={p.id}><div><span className="sourceType">候補 · {p.scope}</span><b>{p.rule}</b>{p.rationale&&<small>{p.rationale}</small>}<small>{p.sourceDecisionIds.length} decision sources</small></div><div className="governanceActions"><input value={reason[p.id]||''} onChange={e=>setReason(v=>({...v,[p.id]:e.target.value}))} placeholder="却下理由（却下時）"/><button disabled={!!busy} onClick={()=>void review(p.id,'active')}>有効化</button><button disabled={!!busy} onClick={()=>void review(p.id,'rejected')}>却下</button></div></div>)}{!policies?.active.length&&!policies?.candidates.length&&<div className="hint">繰り返しの人間判断からAgentが候補を提案し、人間だけが有効化できます。</div>}</div></section>
 </div>;
}
