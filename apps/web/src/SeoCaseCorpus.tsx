import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import './seo-case-corpus.css';

type Observation = { query: string; position: number | null; title: string; url: string; provider: string; upstreamProvider: string | null; observedAt: string };
type PageEvidence = { url: string; title: string | null; excerpt: string; truncated: boolean };
type Case = {
  id: string; domain: string; topics: string[];
  registrationStatus: 'recent_registration' | 'unknown';
  registrationDate: string | null; domainAgeDaysAtDiscovery: number | null;
  createdAt: string; bestObservedPosition: number | null; observedQueryCount: number;
  observations: Observation[]; pageEvidence: PageEvidence[];
  limitations: string[];
};
type CasesResponse = { items: Case[]; nextPageToken: string | null; scope: string };
type SummaryResponse = { analyzedCases: number; scope: string; recentRegistration: number; ageUnknown: number; topicCoverage: Array<{topic:string; domainCount:number; examples:string[]}>; observedQueryForms: Array<{form:string;count:number}> };
const ENDPOINT = ['localhost', '127.0.0.1'].includes(window.location.hostname) ? '/seo-case-corpus' : '/api/theme-research?resource=seo-case-corpus';
const SUMMARY = ['localhost', '127.0.0.1'].includes(window.location.hostname) ? '/seo-case-summary' : '/api/theme-research?resource=seo-case-summary';
const fmt = (date: string | null) => date ? new Date(date).toLocaleDateString('ja-JP') : '未確認';
const ageText = (item: Case) => item.registrationStatus === 'recent_registration' ? '登録日確認' : '登録日不明';

export function SeoCaseCorpus() {
  const [items, setItems] = useState<Case[]>([]);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('all');
  const [selected, setSelected] = useState('');
  useEffect(() => {
    Promise.all([api<CasesResponse>(ENDPOINT + (ENDPOINT.includes('?') ? '&' : '?') + 'limit=50'), api<SummaryResponse>(SUMMARY)])
      .then(([list, overview]) => { setItems(list.items); setToken(list.nextPageToken); setSummary(overview); })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);
  const topics = useMemo(() => [...new Set(items.flatMap(item => item.topics ?? []))].sort(), [items]);
  const filtered = useMemo(() => items.filter(item => {
    if (topic !== 'all' && !item.topics.includes(topic)) return false;
    const q = query.trim().toLowerCase();
    return !q || [item.domain, ...item.topics, ...(item.observations ?? []).flatMap(o => [o.query, o.title])].join(' ').toLowerCase().includes(q);
  }), [items, topic, query]);
  const current = filtered.find(item => item.id === selected) ?? filtered[0] ?? null;
  async function loadMore() {
    if (!token || loadingMore) return;
    setLoadingMore(true);
    try {
      const sep = ENDPOINT.includes('?') ? '&' : '?';
      const next = await api<CasesResponse>(ENDPOINT + sep + 'limit=50&pageToken=' + encodeURIComponent(token));
      setItems(previous => [...previous, ...next.items.filter(item => !previous.some(existing => existing.id === item.id))]);
      setToken(next.nextPageToken);
    } catch(err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoadingMore(false); }
  }
  if (loading) return <section className="corePage"><p>事例DBを読み込み中…</p></section>;
  return <section className="corePage seoCasePage">
    <p className="coreEyebrow">SEO / CASE LIBRARY</p>
    <div className="seoCaseIntro">
      <div><h1>新興サイト事例研究</h1><p>順位を追いかけるより、多様なサイトの実例を集める。検索上位に現れたドメインと具体的な記事を、新規サイト企画とSEO研究の素材として蓄積します。</p></div>
      <div className="seoCaseIntroCount"><strong>{items.length}</strong><span>読み込み済みサイト数</span></div>
    </div>
    <p className="seoCaseCaveat">観測順位は取得時点の検索プロバイダーの結果。新規登録ドメイン＝新規開設サイトではなく、上位表示＝SEO成功の因果証明でもありません。</p>
    {summary && <div className="seoCaseStats">
      <div><small>初回発見サンプル</small><b>{summary.analyzedCases}</b><span>集計は直近の最大100件</span></div>
      <div><small>登録日を確認</small><b>{summary.recentRegistration}</b><span>サイトの開設日は未確定</span></div>
      <div><small>登録日不明</small><b>{summary.ageUnknown}</b><span>未検証として分離</span></div>
      <div><small>調査テーマ</small><b>{summary.topicCoverage.length}</b><span>テーマは収集時の分類</span></div>
    </div>}
    {error && <div className="coreError" role="alert">{error}</div>}
    <div className="seoCaseTools">
      <input aria-label="サイトと検索語を検索" value={query} onChange={e=>setQuery(e.target.value)} placeholder="ドメイン・記事・検索語で絞り込む" />
      <select aria-label="調査テーマ" value={topic} onChange={e=>setTopic(e.target.value)}>
        <option value="all">すべてのテーマ</option>{topics.map(t=><option key={t} value={t}>{t}</option>)}
      </select>
      <span>表示 {filtered.length} / 読込 {items.length}</span>
    </div>
    {items.length===0 && <div className="seoCaseEmpty"><h2>まだ事例がありません</h2><p>Keywords OperatorのMCP <code>seo_case_collect</code> を使うと、検索結果で発見した新興ドメインがこの一覧に保存されます。記録されていない順位や成功事例は表示しません。</p></div>}
    {items.length>0 && <div className="seoCaseLayout">
      <div className="seoCaseList">{filtered.map(item=><button key={item.id} className={'seoCaseItem '+(current?.id===item.id?'isSelected':'')} onClick={()=>setSelected(item.id)}>
        <div><strong>{item.domain}</strong><span>{ageText(item)}</span></div>
        <small>{item.topics.join(' / ')} · 最良観測順位 {item.bestObservedPosition??'不明'}位 · 検索語 {item.observedQueryCount}件</small>
        <p>{item.observations[0]?.title ?? '記事タイトルなし'}</p>
      </button>)}
      {filtered.length===0 && <p className="seoCaseCaveat">この読み込み範囲に一致する事例はありません。</p>}
      {token && <button className="seoCaseMore" onClick={loadMore} disabled={loadingMore}>{loadingMore?'読み込み中…':'さらに50件読み込む'}</button>}
      </div>
      <div className="seoCaseDetail">
        {current ? <>
          <p className="coreEyebrow">OBSERVED CASE / {current.id.slice(-6)}</p>
          <h2>{current.domain}</h2>
          <p className="seoCaseCaveat">初回収集 {fmt(current.createdAt)} ・ ドメイン登録 {fmt(current.registrationDate)}（{ageText(current)}）</p>
          <h3>検索結果で見つかったページ</h3>
          <div className="seoCaseHits">{current.observations.map((hit,index)=><div key={index}>
            <span>#{hit.position??'?'} · {hit.provider}{hit.upstreamProvider?' / '+hit.upstreamProvider:''}</span>
            <a href={hit.url} target="_blank" rel="noopener noreferrer">{hit.title || hit.url} ↗</a>
            <small>検索語：{hit.query} ／ 観測：{fmt(hit.observedAt)}</small>
          </div>)}</div>
          <h3>本文から取得した断片</h3>
          {current.pageEvidence.length ? current.pageEvidence.map((page,index)=><div className="seoCaseExcerpt" key={index}><a href={page.url} target="_blank" rel="noopener noreferrer">{page.title||page.url} ↗</a><p>{page.excerpt}</p>{page.truncated&&<small>本文は一部のみ取得</small>}</div>) : <p className="seoCaseCaveat">本文の取得記録はありません。記事の独自性は未評価です。</p>}
          <h3>サイトテーマの発想に使うなら</h3>
          <p className="seoCaseCaveat">検索語と実際の回答形式を比較し、どんな情報を独自に集めると価値が出るかを考えるための参考です。企画案・市場需要・SEO勝因の判定は別途必要です。</p>
          <div className="seoCaseQueryPills">{[...new Set(current.observations.map(hit=>hit.query))].map(q=><span key={q}>{q}</span>)}</div>
        </>:<p>左の事例を選択してください。</p>}
      </div>
    </div>}
  </section>;
}
