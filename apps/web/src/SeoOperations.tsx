import { FormEvent, useEffect, useState } from 'react';
import { api } from './api';

type OperatorState = { next: { kind: string; title?: string; reason?: string }; candidates: Array<{ kind: string; title?: string; reason?: string }> };
type LivePage = { id: string; title: string; url: string | null; status: string; lastSeenAt: string | null };
type TrendRow={siteUrl:string;searchType:string;periodDays:number;latest:{position?:number;clicks:number;impressions?:number;startDate:string;endDate:string};previous:{position?:number;clicks:number;impressions?:number;startDate:string;endDate:string}};
type MetricContext = {
  definitions:Record<string,string>;
  positionDrops: Array<TrendRow&{query:string;positionDelta:number;impressionDelta:number}>;
  clickDrops: Array<TrendRow&{query:string;clickDelta:number}>;
  pageClickDrops: Array<TrendRow&{url:string;clickDelta:number}>;
  querySnapshots:number;pageSnapshots:number;loadedForComparison:{queries:number;pages:number};comparisonTruncated:boolean;
};
type CaptureResult={siteUrl:string;searchType:string;period:{startDate:string;endDate:string;days:number};queries:{rows:number;complete:boolean};pages:{rows:number;complete:boolean};requests:number;capturedAt:string};

type Props = { projectId: string; onChanged?: () => void | Promise<void> };
export function SeoOperations({ projectId, onChanged }: Props) {
  const [operator,setOperator]=useState<OperatorState|null>(null),[pages,setPages]=useState<LivePage[]>([]),[metrics,setMetrics]=useState<MetricContext|null>(null),[captureResult,setCaptureResult]=useState<CaptureResult|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState('');
  const load=async()=>{if(!projectId)return;try{const[o,p,m]=await Promise.all([api<OperatorState>(`/projects/${projectId}/operator`),api<LivePage[]>(`/projects/${projectId}/site`),api<MetricContext>(`/projects/${projectId}/metrics/context?limit=8`)]);setOperator(o);setPages(p);setMetrics(m);setError('')}catch(e){setError(String(e))}};
  useEffect(()=>{setCaptureResult(null);void load()},[projectId]);
  async function refreshAfterChange(){await Promise.all([load(),Promise.resolve(onChanged?.())])}
  async function tick(){try{setBusy('operator');await api(`/projects/${projectId}/operator/tick`,{method:'POST',body:'{}'});await refreshAfterChange()}catch(e){setError(String(e))}finally{setBusy('')}}
  async function syncSite(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);try{setBusy('site');await api(`/projects/${projectId}/site/sync`,{method:'POST',body:JSON.stringify({sitemapUrl:f.get('sitemap')||undefined})});await refreshAfterChange()}catch(e){setError(String(e))}finally{setBusy('')}}
  async function capture(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);try{setBusy('metrics');const result=await api<CaptureResult>(`/projects/${projectId}/metrics/capture`,{method:'POST',body:JSON.stringify({startDate:f.get('startDate'),endDate:f.get('endDate'),siteUrl:f.get('siteUrl')||undefined,searchType:f.get('searchType')||'web',rowLimit:Number(f.get('rowLimit')||25000)})});setCaptureResult(result);await refreshAfterChange()}catch(e){setError(String(e))}finally{setBusy('')}}
  return <section className="panel policyPanel">
    <div className="panelHead"><div><p className="eyebrow">SEO OPERATIONS</p><h2>Operator · site · Search Console</h2></div><span>{pages.length} live URLs</span></div>{error&&<div className="error">{error}</div>}
    <div className="policyList">
      <div className="policyRule activePolicy"><div><span className="sourceType">operator</span><b>{operator?.next.title??operator?.next.kind??'No action'}</b><small>{operator?.next.reason??'No prioritized operator action.'}</small></div><div className="pageActions"><button disabled={busy==='operator'} onClick={()=>void tick()}>{busy==='operator'?'Running…':'Choose next task'}</button></div></div>
      <div className="policyRule"><div><span className="sourceType">live site</span><b>{pages.length} imported URLs</b><small>{pages[0]?.lastSeenAt?`Last seen ${new Date(pages[0].lastSeenAt).toLocaleString()}`:'Sync sitemap to import the real site.'}</small></div><form className="pageActions" onSubmit={syncSite}><input name="sitemap" placeholder="sitemap URL (optional)"/><button disabled={busy==='site'}>{busy==='site'?'Syncing…':'Sync'}</button></form></div>
      <div className="policyRule gscRule"><div><span className="sourceType">gsc history</span><b>{metrics?.querySnapshots??0} query · {metrics?.pageSnapshots??0} page snapshots</b><small>比較は同じproperty・search type・期間長の非重複periodだけ。最大10,000行/種を比較コンテキストへ読み込みます。</small>{metrics?.comparisonTruncated&&<small className="warningText">保存済みsnapshotが10,000行を超えるため、比較候補の読み込みは一部です。</small>}</div><form className="gscCaptureForm" onSubmit={capture}><input name="startDate" type="date" required/><input name="endDate" type="date" required/><input name="siteUrl" placeholder="GSC property (optional)"/><select name="searchType" defaultValue="web"><option value="web">web</option><option value="image">image</option><option value="video">video</option><option value="news">news</option><option value="discover">discover</option><option value="googleNews">googleNews</option></select><input name="rowLimit" type="number" min="1" max="100000" defaultValue="25000" title="dimensionごとの最大取得行数"/><button disabled={busy==='metrics'}>{busy==='metrics'?'Capturing…':'Capture'}</button></form></div>
    </div>
    {captureResult&&<div className="gscCaptureResult"><b>Captured {captureResult.siteUrl}</b><span>{captureResult.period.startDate}–{captureResult.period.endDate} · {captureResult.period.days}日 · {captureResult.searchType}</span><span>Query {captureResult.queries.rows}行 ({captureResult.queries.complete?'完全取得':'上限到達'}) · Page {captureResult.pages.rows}行 ({captureResult.pages.complete?'完全取得':'上限到達'}) · API {captureResult.requests} requests</span>{(!captureResult.queries.complete||!captureResult.pages.complete)&&<small>上限到達は「0件」ではありません。必要ならrow limitを増やして再取得してください。</small>}</div>}
    <div className="sourceList" style={{marginTop:12}}>{metrics?.positionDrops.slice(0,4).map(row=><div className="source" key={`${row.query}-${row.siteUrl}-${row.searchType}`}><span className="sourceType">position ↓</span><div><b>{row.query}</b><small>{row.previous.position?.toFixed(1)} → {row.latest.position?.toFixed(1)} · clicks {row.previous.clicks} → {row.latest.clicks}</small><small>{row.siteUrl} · {row.searchType} · {row.periodDays}日比較 · {row.previous.startDate}–{row.previous.endDate} → {row.latest.startDate}–{row.latest.endDate}</small></div></div>)}{!metrics?.positionDrops.length&&<div className="hint">互換条件を満たす最新2期間に、3位以上の平均順位悪化は検出されていません。snapshot未取得と変化なしは別です。</div>}</div>
  </section>;
}
