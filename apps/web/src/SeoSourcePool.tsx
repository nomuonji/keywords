import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

type Finding = {
  url: string;
  publishedAt: string | null;
  claimSummary: string;
  relevance: string;
  disposition: 'candidate' | 'adopted' | 'rejected' | 'watch';
  confidence: string;
  verificationNeeded: boolean;
  evaluatorIds: string[];
  notes: string;
};
type Scan = {
  id: string;
  reviewedAt: string;
  outcome: 'useful' | 'mixed' | 'nothing_new' | 'needs_followup' | 'unavailable';
  summary: string;
  findings: Finding[];
  limitations: string[];
};
type Source = {
  id: string;
  sourceType: string;
  label: string;
  canonicalUrl: string;
  handle: string | null;
  topics: string[];
  whyWatch: string;
  trustNotes: string;
  status: string;
  reviewCadenceDays: number;
  origin: string;
  dueForReview: boolean;
  latestScan: Scan | null;
};
type Context = {
  generatedAt: string;
  mission: string;
  rules: string[];
  items: Source[];
  dueSourceIds: string[];
  recentUsefulFindings: Array<Finding & { sourceId: string; sourceLabel: string; scanId: string; reviewedAt: string; outcome: string }>;
};

const endpoint = ['localhost', '127.0.0.1'].includes(window.location.hostname) ? '/seo-source-pool' : '/api/seo-source-pool';
const fmt = (v?: string | null) => v ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) : '未確認';

export function SeoSourcePool() {
  const [context, setContext] = useState<Context | null>(null);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<Context>(endpoint).then(data => {
      setContext(data);
      setSelected(data.items[0]?.id ?? '');
    }).catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const visible = useMemo(() => {
    if (!context) return [];
    const q = query.trim().toLowerCase();
    return context.items.filter(item => !q || [item.label, item.handle ?? '', ...item.topics, item.whyWatch].join(' ').toLowerCase().includes(q));
  }, [context, query]);
  const current = visible.find(item => item.id === selected) ?? visible[0] ?? null;

  if (error) return <div className="corePage"><div className="coreError">{error}</div></div>;
  if (!context) return <div className="corePage"><div className="dashboardSkeleton">{Array.from({length:4},(_,i)=><span key={i}/>)}</div></div>;

  return <div className="corePage">
    <div className="coreTitleRow">
      <div><p className="coreEyebrow">SEO SOURCE WATCH</p><h1>情報源プール</h1><p>人・メディアを監視対象として貯め、最近の発信から検証すべきSEO示唆だけを残す。</p></div>
      <div className="coreLive"><span/>{context.dueSourceIds.length} sources due</div>
    </div>

    <div className="coreToolbar">
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="アカウント・テーマを検索" />
      <span>{visible.length} sources</span>
    </div>

    <div className="sourcePoolLayout">
      <section className="sourcePoolList">
        {visible.map(item => <button key={item.id} className={current?.id===item.id?'selected':''} onClick={()=>setSelected(item.id)}>
          <div><b>{item.label}</b>{item.dueForReview?<em className="workPill">要確認</em>:<em className="goodPill">確認済</em>}</div>
          <small>{item.sourceType} · {item.latestScan ? fmt(item.latestScan.reviewedAt) : 'scanなし'}</small>
          <p>{item.topics.slice(0,4).join(' · ')}</p>
        </button>)}
      </section>

      <section className="coreSection sourcePoolDetail">
        {current ? <>
          <div className="coreSectionHead"><div><p className="coreEyebrow">{current.sourceType}</p><h2>{current.label}</h2></div><a href={current.canonicalUrl} target="_blank" rel="noreferrer">元ソース ↗</a></div>
          <dl className="sourceMeta">
            <div><dt>WHY WATCH</dt><dd>{current.whyWatch}</dd></div>
            <div><dt>TRUST BOUNDARY</dt><dd>{current.trustNotes}</dd></div>
            <div><dt>CADENCE</dt><dd>{current.reviewCadenceDays}日ごと</dd></div>
          </dl>
          <h3>最新Scan</h3>
          {current.latestScan ? <div className="sourceScan">
            <div><span className={'statusPill '+(current.latestScan.outcome==='useful'?'good':current.latestScan.outcome==='nothing_new'?'neutral':'work')}>{current.latestScan.outcome}</span><small>{fmt(current.latestScan.reviewedAt)}</small></div>
            <p>{current.latestScan.summary}</p>
            {current.latestScan.findings.map((f,i)=><article key={i}>
              <div><b>{f.claimSummary}</b><span className="decision">{f.disposition}</span></div>
              <p>{f.relevance}</p>
              <small>{f.confidence} · {f.verificationNeeded?'要一次確認':'確認済'}{f.evaluatorIds.length ? ' · ' + f.evaluatorIds.join(', ') : ''}</small>
              <a href={f.url} target="_blank" rel="noreferrer">投稿を見る ↗</a>
            </article>)}
          </div> : <p className="coreEmpty">まだScanされていません。エージェントに「最近この人何か有益なこと言ってる？」と依頼できます。</p>}
        </> : <p className="coreEmpty">情報源がありません。</p>}
      </section>
    </div>

    <section className="coreSection">
      <div className="coreSectionHead"><div><p className="coreEyebrow">RECENT FINDINGS</p><h2>最近拾った示唆</h2></div><small>{context.recentUsefulFindings.length}件</small></div>
      <div className="compactRows">{context.recentUsefulFindings.slice(0,12).map((f,i)=><div className="decisionRow" key={i}>
        <div><b>{f.sourceLabel}</b><small>{fmt(f.reviewedAt)} · {f.confidence}</small></div><span className={'decision '+f.disposition}>{f.disposition}</span>
        <p>{f.claimSummary} — {f.relevance}</p>
      </div>)}</div>
      {!context.recentUsefulFindings.length&&<p className="coreEmpty">まだFindingはありません。</p>}
    </section>
  </div>;
}
