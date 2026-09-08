import { useEffect, useState } from 'react';
import { api } from './api';
import './portfolio.css';

type Totals = Record<string, number | null>;
type Site = { name: string; host: string; error: boolean; signal: string; clickChange: number | null; sessionChange: number | null; gsc: { current: Totals | null; previous: Totals | null }; ga4: { current: Totals | null; previous: Totals | null }; projects: Array<{ id: string; name: string }>; openTasks: number; openReviews: number };
type Portfolio = { status: string; generatedAt: string | null; period: { start: string | null; end: string | null; previousStart: string | null; previousEnd: string | null } | null; stale: boolean; comparable: boolean; message: string | null; sites: Site[] };
const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
const delta = (value: number | null) => value == null ? '比較なし' : `${value > 0 ? '+' : ''}${number(value)}%`;

export function PortfolioWorkspace({ onOpen }: { onOpen: (id: string, view: 'performance' | 'work') => void }) {
  const [data, setData] = useState<Portfolio | null>(null), [error, setError] = useState(''), [filter, setFilter] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => { const abort = new AbortController(); setError(''); api<Portfolio>('/portfolio', { signal: abort.signal }).then(setData).catch(e => { if (!abort.signal.aborted) setError(String(e)); }); return () => abort.abort(); }, [revision]);
  const sites = data?.sites.filter(site => `${site.name} ${site.host} ${site.signal}`.toLowerCase().includes(filter.toLowerCase())) ?? [];
  return <div className="productStack portfolioWorkspace"><header className="productHeader"><div><p className="eyebrow">BLOG PORTFOLIO</p><h1>サイト群の実績</h1><p>GA4・検索流入から確認するサイトを選び、改善作業と公開後の観測へ進みます。</p></div><button onClick={() => setRevision(v => v + 1)}>保存データを再読込</button></header>
    {error && <div className="error" role="alert">{error}</div>}
    {!data && !error && <p>実績を読み込み中…</p>}
    {data && <><section className="panel"><p>更新日時: {data.generatedAt ? new Date(data.generatedAt).toLocaleString('ja-JP') : '不明'} · {data.sites.length}サイト</p>
      {data.period && <p>対象: {data.period.start} 〜 {data.period.end} ／ 比較: {data.period.previousStart} 〜 {data.period.previousEnd}</p>}
      {data.message && <p role="alert">{data.message}</p>}
      {data.stale && <p className="hint">データが古いか、取得時点を確認できません。最新値を取得してから施策を判断してください。</p>}
      {!data.comparable && <p className="hint">同じ日数・重ならない期間が揃っていないため、増減は表示しません。</p>}
      <p>更新: Blogフォルダで <code>py analytics-dashboard/scripts/refresh.py</code> を実行後、再読込してください。</p>
      <p>この一覧はdashboardの保存データを読みます。Keywordsの検索履歴・企画の効果測定は、各サイトの「実績・Blog連携」で確認できます。</p>
      <label>サイト・状態で絞り込み <input aria-label="サイト・状態で絞り込み" value={filter} onChange={e => setFilter(e.target.value)} placeholder="サイト名 / ドメイン / レビュー待ち" /></label>
    </section><section className="panel" style={{ overflowX: 'auto' }}><table><thead><tr><th>サイト / 確認事項</th><th>検索クリック</th><th>検索表示</th><th>GA4セッション</th><th>作業</th><th>Keywordsで開く</th></tr></thead><tbody>
      {sites.map(site => <tr key={site.host}><td><b>{site.name}</b><p>{site.host}</p><small>{site.signal}</small></td><td>{number(site.error ? null : site.gsc.current?.clicks)}<p>{delta(site.clickChange)}</p></td><td>{number(site.error ? null : site.gsc.current?.impressions)}</td><td>{number(site.error ? null : site.ga4.current?.sessions)}<p>{delta(site.sessionChange)}</p></td><td>未完了 {site.openTasks}<p>レビュー {site.openReviews}</p></td><td>{site.projects.length ? site.projects.map(project => <div key={project.id}><small>{project.name}</small><p><button onClick={() => onOpen(project.id, 'performance')}>実績・Blog連携</button> <button onClick={() => onOpen(project.id, 'work')}>作業・レビュー</button></p></div>) : <span>未接続: 同じドメインのプロジェクトを作成してください。</span>}</td></tr>)}
    </tbody></table>{!sites.length && <p>該当するサイトはありません。</p>}</section></>}
  </div>;
}
