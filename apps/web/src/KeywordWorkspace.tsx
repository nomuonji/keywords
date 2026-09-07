import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { KeywordDetail, KeywordSearchResult } from './product-types';

const PAGE=50;
const statusLabel:Record<string,string>={discovered:'未確認',shortlisted:'候補入り',hold:'保留',rejected:'除外',research_more:'追加調査',planned:'企画済み'};
const when=(value:string|null|undefined)=>value?new Date(value).toLocaleString():'—';

export function KeywordWorkspace({projectId}:{projectId:string}){
 const [query,setQuery]=useState(''),[status,setStatus]=useState(''),[cluster,setCluster]=useState(''),[existingPage,setExistingPage]=useState(''),[research,setResearch]=useState(''),[provider,setProvider]=useState(''),[sort,setSort]=useState('demand_desc'),[offset,setOffset]=useState(0);
 const [data,setData]=useState<KeywordSearchResult|null>(null),[detail,setDetail]=useState<KeywordDetail|null>(null),[selected,setSelected]=useState<Set<string>>(new Set()),[bulkReason,setBulkReason]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState('');
 const paramsFor=(nextOffset:number)=>{const params=new URLSearchParams({limit:String(PAGE),offset:String(nextOffset),sort});if(query)params.set('q',query);if(status)params.set('candidateStatus',status);if(cluster)params.set('clusterId',cluster);if(existingPage)params.set('existingPage',existingPage);if(research)params.set('researchStatus',research);if(provider)params.set('provider',provider);return params};
 const load=async(nextOffset=offset)=>{try{setLoading(true);const result=await api<KeywordSearchResult>(`/projects/${projectId}/keywords/search?${paramsFor(nextOffset)}`);setData(result);setSelected(new Set());setError('')}catch(e){setError(String(e))}finally{setLoading(false)}};
 useEffect(()=>{setOffset(0);setDetail(null);setQuery('');setStatus('');setCluster('');setExistingPage('');setResearch('');setProvider('');setSort('demand_desc');void (async()=>{try{setLoading(true);setData(await api<KeywordSearchResult>(`/projects/${projectId}/keywords/search?limit=${PAGE}&offset=0&sort=demand_desc`));setError('')}catch(e){setError(String(e))}finally{setLoading(false)}})()},[projectId]);
 function search(e:FormEvent){e.preventDefault();setOffset(0);void load(0)}
 const move=(next:number)=>{setOffset(next);void load(next)};
 const selectable=useMemo(()=>data?.items.filter(row=>row.candidate&&!['planned'].includes(row.candidate.status))??[],[data]);
 function toggle(id:string){setSelected(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next})}
 function togglePage(){setSelected(current=>current.size===selectable.length&&selectable.length?new Set():new Set(selectable.map(row=>row.keyword.id)))}
 async function openDetail(keywordId:string){try{setBusy(`detail:${keywordId}`);setDetail(await api<KeywordDetail>(`/projects/${projectId}/keywords/${keywordId}/detail`));setError('')}catch(e){setError(String(e))}finally{setBusy('')}}
 async function bulkReview(nextStatus:'shortlisted'|'hold'|'rejected'){
   const rows=(data?.items??[]).filter(row=>selected.has(row.keyword.id)&&row.candidate);
   const candidateIds=rows.map(row=>row.candidate!.id);
   if(!candidateIds.length){setError('Discovery候補を選択してください。');return}
   if((nextStatus==='hold'||nextStatus==='rejected')&&!bulkReason.trim()){setError('保留・除外の一括操作には理由を入力してください。');return}
   try{setBusy(`bulk:${nextStatus}`);setError('');await api(`/projects/${projectId}/discovery-candidates/bulk-review`,{method:'POST',body:JSON.stringify({candidateIds,status:nextStatus,reason:bulkReason.trim()||undefined})});setBulkReason('');await load(offset);if(detail&&selected.has(detail.keyword.id))setDetail(await api<KeywordDetail>(`/projects/${projectId}/keywords/${detail.keyword.id}/detail`))}catch(e){setError(String(e))}finally{setBusy('')}
 }
 return <div className="productStack">
  {error&&<div className="error">{error}</div>}
  <section className="panel"><div className="panelHead"><div><p className="eyebrow">KEYWORD WORKSPACE</p><h2>キーワード</h2></div><span>{data?.total??0}件</span></div>
   <form className="keywordFilters" onSubmit={search}>
    <label className="wide"><span>検索</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="キーワードを検索"/></label>
    <label><span>候補状態</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">すべて</option><option value="discovered">未確認</option><option value="shortlisted">候補入り</option><option value="hold">保留</option><option value="research_more">追加調査</option><option value="planned">企画済み</option><option value="rejected">除外</option></select></label>
    <label><span>クラスタ</span><select value={cluster} onChange={e=>setCluster(e.target.value)}><option value="">すべて</option>{data?.facets.clusters.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
    <label><span>既存ページ</span><select value={existingPage} onChange={e=>setExistingPage(e.target.value)}><option value="">すべて</option><option value="with">あり</option><option value="without">なし</option></select></label>
    <label><span>調査状態</span><select value={research} onChange={e=>setResearch(e.target.value)}><option value="">すべて</option><option value="researched">調査済み</option><option value="unresearched">未調査</option><option value="failed">失敗</option></select></label>
    <label><span>Provider</span><select value={provider} onChange={e=>setProvider(e.target.value)}><option value="">すべて</option>{data?.facets.providers.map(p=><option key={p} value={p}>{p}</option>)}</select></label>
    <label><span>並び順</span><select value={sort} onChange={e=>setSort(e.target.value)}><option value="demand_desc">需要順</option><option value="gsc_impressions_desc">GSC表示回数順</option><option value="keyword_asc">キーワード順</option><option value="updated_desc">更新順</option></select></label>
    <button>絞り込む</button>
   </form>
   <div className="bulkBar"><label><input type="checkbox" checked={selectable.length>0&&selected.size===selectable.length} onChange={togglePage}/> このページを選択</label><span>{selected.size}件選択</span><input value={bulkReason} onChange={e=>setBulkReason(e.target.value)} placeholder="保留・除外理由（候補入りは任意）"/><button disabled={!selected.size||!!busy} onClick={()=>void bulkReview('shortlisted')}>候補入り</button><button disabled={!selected.size||!!busy} onClick={()=>void bulkReview('hold')}>保留</button><button disabled={!selected.size||!!busy} onClick={()=>void bulkReview('rejected')}>除外</button></div>
   {loading&&<div className="hint">読み込み中…</div>}
   <div className="keywordTable"><div className="keywordHeader keywordHeaderFull"><span>選択</span><span>Keyword</span><span>Discovery</span><span>Demand / Ads</span><span>GSC</span><span>Cluster / Page</span></div>{data?.items.map(row=><div className="keywordLine keywordLineFull" key={row.keyword.id}><div><input type="checkbox" disabled={!row.candidate||row.candidate.status==='planned'} checked={selected.has(row.keyword.id)} onChange={()=>toggle(row.keyword.id)}/></div><button className="keywordOpen" onClick={()=>void openDetail(row.keyword.id)}><b>{row.keyword.text}</b><small>{row.keyword.source} · {row.keyword.status}</small></button><div>{row.candidate?<><span className={`status ${row.candidate.status}`}>{statusLabel[row.candidate.status]||row.candidate.status}</span><small>{row.candidate.searchIntent||'検索意図未確認'}</small><small>{row.candidate.evidenceCount} evidence · SERP {row.candidate.serpStatus}</small></>:<span>—</span>}</div><div><b>{row.keyword.avgMonthly??'未取得'}</b><small>{row.keyword.competition===null?'広告競合度 未取得':`広告競合度 ${Math.round(row.keyword.competition*100)}%`}</small></div><div><b>{row.keyword.gscImpressions===null?'未取得':`${Math.round(row.keyword.gscImpressions)} imp`}</b><small>{row.keyword.gscPosition===null?'順位未取得':`平均順位 ${row.keyword.gscPosition.toFixed(1)}`}</small></div><div>{row.clusterTitle||'未クラスタ'}<small>既存/企画ページ {row.existingPageCount}件</small></div></div>)}</div>
   {!loading&&!data?.items.length&&<div className="hint">条件に一致するキーワードはありません。0件と未取得は別表示です。</div>}
   <div className="pagination"><button disabled={offset===0} onClick={()=>move(Math.max(0,offset-PAGE))}>前へ</button><span>{data&&data.total?`${offset+1}–${Math.min(offset+PAGE,data.total)} / ${data.total}`:'0件'}</span><button disabled={!data||offset+PAGE>=data.total} onClick={()=>move(offset+PAGE)}>次へ</button></div>
  </section>
  {detail&&<section className="panel keywordDetail"><div className="panelHead"><div><p className="eyebrow">KEYWORD DETAIL</p><h2>{detail.keyword.text}</h2></div><button className="quietButton" onClick={()=>setDetail(null)}>閉じる</button></div>
   <div className="detailGrid"><div><h3>現在値</h3><p>月間検索: <b>{detail.keyword.avgMonthly??'未取得'}</b></p><p>広告競合度: {detail.keyword.competition===null?'未取得':`${Math.round(detail.keyword.competition*100)}%`}</p><p>GSC: {detail.keyword.gscImpressions??'未取得'} imp / 順位 {detail.keyword.gscPosition?.toFixed(1)??'未取得'}</p><p>クラスタ: {detail.cluster?.title||'未設定'}</p></div>
   <div><h3>ページ</h3>{detail.pages.map(p=><p key={p.id}><b>{p.title}</b> · {p.role} · {p.status}{p.url&&<small> {p.url}</small>}</p>)}{!detail.pages.length&&<p className="hint">対象ページなし</p>}</div>
   <div><h3>Discovery履歴</h3>{detail.candidates.map(c=><p key={c.id}><span className={`status ${c.status}`}>{statusLabel[c.status]||c.status}</span> {c.demandProvider||'providerなし'} · Evidence {c.evidenceCount}<small> {c.unresolvedQuestions.join(' / ')}</small></p>)}{!detail.candidates.length&&<p className="hint">Discovery履歴なし</p>}</div>
   <div><h3>Evidence</h3>{detail.evidence.map((e,i)=><p key={`${e.source.id}-${i}`}><b>{e.source.type}</b> · {e.source.label}<small> {when(e.source.createdAt)}</small></p>)}{!detail.evidence.length&&<p className="hint">Evidenceなし</p>}</div>
   <div><h3>判断履歴</h3>{detail.decisions.map(d=><p key={d.id}><b>{d.verdict}</b> · {d.action}<small>{d.reason?` — ${d.reason}`:''} · {when(d.createdAt)}</small></p>)}{!detail.decisions.length&&<p className="hint">判断履歴なし</p>}</div>
   <div><h3>GSC履歴</h3>{detail.metricSnapshots.map(s=><p key={s.id}><b>{s.startDate}–{s.endDate}</b> · {s.impressions} imp / {s.clicks} clicks / pos {s.position.toFixed(1)}<small>{s.siteUrl} · {s.searchType||'web'}</small></p>)}{!detail.metricSnapshots.length&&<p className="hint">GSC履歴なし</p>}</div></div>
  </section>}
 </div>;
}