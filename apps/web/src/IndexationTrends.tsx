import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

type SiteOption = { id: string; name: string; status: string };
type IndexationCounts = {
  indexableCount: number;
  inspectedCount: number;
  indexedObservedCount: number;
  notIndexedObservedCount: number;
  unknownObservedCount: number;
  observedIndexationRate: number | null;
};
type SiteSummary = IndexationCounts & {
  generatedAt: string;
  byPageFamily: Record<string, IndexationCounts>;
};
type WeeklySnapshot = {
  weekStart: string;
  capturedAt: string;
  summary: SiteSummary;
};
type IndexationHistory = {
  siteId: string;
  current: SiteSummary;
  snapshots: WeeklySnapshot[];
  requestedWeeks: number;
};
type ChartRow = { date: string; capturedAt: string; indexed: number; notIndexed: number; inspected: number; indexable: number };
const fmt = (value?: number | null) => value == null ? '—' : value.toLocaleString('ja-JP');
const dateLabel = (value: string) => new Date(value).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
const observationRate = (counts?: IndexationCounts) => counts?.observedIndexationRate == null ? '—' : `${(counts.observedIndexationRate * 100).toFixed(1)}%`;

function RecordedChart({ rows }: { rows: ChartRow[] }) {
  if (!rows.length) return <div className="indexationEmpty">週次スナップショットはまだありません。次回の定期保存後から推移が表示されます。</div>;
  const width = 820, height = 248, left = 46, right = 15, top = 18, bottom = 36;
  const innerWidth = width - left - right, innerHeight = height - top - bottom;
  const first = Date.parse(rows[0].date), last = Date.parse(rows[rows.length - 1].date);
  const span = Math.max(7 * 86400000, last - first);
  const upper = Math.max(1, ...rows.flatMap(row => [row.indexed, row.notIndexed]));
  const yMax = Math.ceil(upper / 4) * 4 || 4;
  const x = (date: string) => left + ((Date.parse(date) - first) / span) * innerWidth;
  const y = (value: number) => top + innerHeight - (value / yMax) * innerHeight;
  const series = [
    { key: 'indexed' as const, label: '登録済み', color: '#b6ef84' },
    { key: 'notIndexed' as const, label: '未登録', color: '#e9af79' }
  ];
  const marks = [0, 1, 2, 3, 4];
  const labelIndices = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])];

  return <div className="indexationChartWrap">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="保存済みの週別インデックス登録数と未登録数の折れ線グラフ">
      {marks.map(index => {
        const value = yMax * index / 4;
        return <g key={index}>
          <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#304139" strokeDasharray={index ? '3 5' : undefined} />
          <text x={left - 9} y={y(value) + 4} textAnchor="end" fill="#7d9488" fontSize="11">{fmt(value)}</text>
        </g>;
      })}
      {series.map(item => {
        const points = rows.map(row => `${x(row.date)},${y(row[item.key])}`).join(' ');
        return <g key={item.key}>
          {rows.length > 1 && <polyline points={points} fill="none" stroke={item.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
          {rows.map(row => <circle key={row.date} cx={x(row.date)} cy={y(row[item.key])} r={4} fill={item.color} stroke="#14221b" strokeWidth="2">
            <title>{`${row.date} · ${item.label} ${fmt(row[item.key])} URL`}</title>
          </circle>)}
        </g>;
      })}
      {labelIndices.map(index => <text key={index} x={x(rows[index].date)} y={height - 9} textAnchor={index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle'} fontSize="11" fill="#8da198">{dateLabel(rows[index].date)}</text>)}
    </svg>
  </div>;
}

export function IndexationTrends({ sites }: { sites: SiteOption[] }) {
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [family, setFamily] = useState('');
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<IndexationHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (sites.length && !sites.some(site => site.id === selectedSiteId)) {
      setSelectedSiteId(sites.find(site => site.status === 'active')?.id ?? sites[0].id);
    }
  }, [sites, selectedSiteId]);

  useEffect(() => {
    if (!selectedSiteId) return;
    let cancelled = false;
    setResult(null);
    setLoading(true);
    setError('');
    void api<IndexationHistory>(`/api/remote-sites?__view=indexation&siteId=${encodeURIComponent(selectedSiteId)}`)
      .then(response => { if (!cancelled) setResult(response); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '履歴を取得できません'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedSiteId, reload]);

  const families = useMemo(() => {
    if (!result) return [];
    return [...new Set([
      ...Object.keys(result.current.byPageFamily ?? {}),
      ...result.snapshots.flatMap(snapshot => Object.keys(snapshot.summary.byPageFamily ?? {}))
    ])].sort((a, b) => a.localeCompare(b, 'ja'));
  }, [result]);

  const current = result ? (family ? result.current.byPageFamily?.[family] : result.current) : null;
  const rows = useMemo<ChartRow[]>(() => (result?.snapshots ?? []).flatMap(snapshot => {
    const counts = family ? snapshot.summary.byPageFamily?.[family] : snapshot.summary;
    if (!counts) return [];
    return [{
      date: snapshot.weekStart,
      capturedAt: snapshot.capturedAt,
      indexed: counts.indexedObservedCount,
      notIndexed: counts.notIndexedObservedCount,
      inspected: counts.inspectedCount,
      indexable: counts.indexableCount
    }];
  }), [result, family]);
  const latest = rows.at(-1), previous = rows.at(-2);
  const delta = latest && previous ? latest.indexed - previous.indexed : null;

  return <section className="indexationPanel" aria-label="インデックス登録数の推移">
    <div className="indexationPanelHeader">
      <div>
        <p className="coreEyebrow">INDEXATION / SEARCH CONSOLE</p>
        <h2>インデックス登録の推移</h2>
        <p>定期Actionsが記録したURL Inspection結果を表示。Google APIへの追加問い合わせは行いません。</p>
      </div>
      <div className="indexationControls">
        <label>サイト
          <select value={selectedSiteId} onChange={event => { setSelectedSiteId(event.target.value); setFamily(''); }}>
            {!sites.length && <option value="">対象サイトなし</option>}
            {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </label>
        <label>ページ種別
          <select value={family} onChange={event => setFamily(event.target.value)}>
            <option value="">サイト全体</option>
            {families.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setReload(value => value + 1)} disabled={loading || !selectedSiteId}>再読込</button>
      </div>
    </div>
    {error && <div className="coreError" role="alert">履歴を読み込めませんでした：{error}</div>}
    {loading ? <div className="indexationEmpty" role="status">保存済みのインデックス履歴を取得しています…</div> : result && <>
      <div className="indexationStats">
        <div><small>現在の登録確認数</small><strong>{fmt(current?.indexedObservedCount)}</strong><span>最終キャッシュ {dateLabel(result.current.generatedAt)}</span></div>
        <div><small>現在の未登録確認数</small><strong>{fmt(current?.notIndexedObservedCount)}</strong><span>未検査・状態不明は含まない</span></div>
        <div><small>登録率（判定済みURL）</small><strong>{observationRate(current ?? undefined)}</strong><span>検査済み {fmt(current?.inspectedCount)} / 対象 {fmt(current?.indexableCount)}</span></div>
        <div><small>週次登録数の前回比</small><strong className={delta != null && delta < 0 ? 'badText' : delta != null && delta > 0 ? 'goodText' : ''}>{delta == null ? '—' : `${delta > 0 ? '+' : ''}${fmt(delta)}`}</strong><span>{latest ? `最終記録 ${dateLabel(latest.capturedAt)}` : '週次履歴なし'}</span></div>
      </div>
      <div className="indexationChartHeader">
        <div><strong>週次観測</strong><small>{rows.length} 回記録 · 最大 {result.requestedWeeks} 週間</small></div>
        <div className="indexationLegend"><span><i className="indexedDot" />登録済み</span><span><i className="notIndexedDot" />未登録</span></div>
      </div>
      <RecordedChart rows={rows} />
      <details className="indexationDataDetails">
        <summary>数値一覧を見る</summary>
        <div className="indexationTableScroll"><table><thead><tr><th>週の開始日</th><th>登録済み</th><th>未登録</th><th>検査済み</th><th>対象URL</th></tr></thead><tbody>
          {[...rows].reverse().map(row => <tr key={row.date}><td>{row.date}</td><td>{fmt(row.indexed)}</td><td>{fmt(row.notIndexed)}</td><td>{fmt(row.inspected)}</td><td>{fmt(row.indexable)}</td></tr>)}
        </tbody></table></div>
      </details>
      <p className="indexationCaveat">※ URL Inspectionで確認済みの対象URLについての集計です。Search Consoleの「ページのインデックス登録」レポート全体の総数ではありません。週次保存のない週は線を補完せず、最新キャッシュと過去の週次記録を分けて表示します。</p>
    </>}
  </section>;
}
