import { FormEvent, useEffect, useState } from 'react';
import { api } from './api';
import type { KeywordSearchResult } from './product-types';

const PAGE=50;
export function KeywordWorkspace({projectId}:{projectId:string}){
 const [query,setQuery]=useState(''),[status,setStatus]=useState(''),[offset,setOffset]=useState(0),[data,setData]=useState<KeywordSearchResult|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const load=async(nextOffset=offset,nextQuery=query,nextStatus=status)=>{try{setLoading(true);const params=new URLSearchParams({limit:String(PAGE),offset:String(nextOffset)});if(nextQuery)params.set('q',nextQuery);if(nextStatus)params.set('candidateStatus',nextStatus);setData(await api<KeywordSearchResult>(`/projects/${projectId}/keywords/search?${params}`));setError('')}catch(e){setError(String(e))}finally{setLoading(false)}};
 useEffect(()=>{setOffset(0);void load(0,'','')},[projectId]);
 function search(e:FormEvent){e.preventDefault();setOffset(0);void load(0,query,status)}
 const move=(next:number)=>{setOffset(next);void load(next,query,status)};
 return <div className="productStack">
  {error&&<div className="error">{error}</div>}
  <section className="panel"><div className="panelHead"><div><p className="eyebrow">KEYWORD WORKSPACE</p><h2>キーワード</h2></div><span>{data?.total??0}件</span></div>
   <form className="filterBar" onSubmit={search}><label><span>検索</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="キーワードを検索"/></label><label><span>候補状態</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">すべて</option><option value="discovered">未確認</option><option value="shortlisted">候補入り</option><option value="hold">保留</option><option value="research_more">追加調査</option><option value="rejected">除外</option></select></label><button>絞り込む</button></form>
   {loading&&<div className="hint">読み込み中…</div>}
   <div className="keywordTable"><div className="keywordHeader"><span>Keyword</span><span>Discovery</span><span>Demand / Ads</span><span>GSC</span><span>Cluster</span></div>{data?.items.map(row=><div className="keywordLine" key={row.keyword.id}><div><b>{row.keyword.text}</b><small>{row.keyword.source} · {row.keyword.status}</small></div><div>{row.candidate?<><span className={`status ${row.candidate.status}`}>{row.candidate.status}</span><small>{row.candidate.searchIntent||'検索意図未確認'}</small><small>{row.candidate.evidenceCount} evidence · SERP {row.candidate.serpStatus}</small></>:<span>—</span>}</div><div><b>{row.keyword.avgMonthly??'未取得'}</b><small>{row.keyword.competition===null?'広告競合度 未取得':`広告競合度 ${Math.round(row.keyword.competition*100)}%`}</small></div><div><b>{row.keyword.gscImpressions===null?'未取得':`${Math.round(row.keyword.gscImpressions)} imp`}</b><small>{row.keyword.gscPosition===null?'順位未取得':`平均順位 ${row.keyword.gscPosition.toFixed(1)}`}</small></div><div>{row.clusterTitle||'未クラスタ'}{row.clusterId&&<small>{row.clusterId.slice(0,8)}</small>}</div></div>)}</div>
   {!loading&&!data?.items.length&&<div className="hint">条件に一致するキーワードはありません。0件と未取得は別表示です。</div>}
   <div className="pagination"><button disabled={offset===0} onClick={()=>move(Math.max(0,offset-PAGE))}>前へ</button><span>{data?`${offset+1}–${Math.min(offset+PAGE,data.total)} / ${data.total}`:'—'}</span><button disabled={!data||offset+PAGE>=data.total} onClick={()=>move(offset+PAGE)}>次へ</button></div>
  </section>
 </div>;
}
