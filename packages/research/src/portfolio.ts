import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
export function portfolioPath() {
  return resolve(root, process.env.KEYWORDS_ANALYTICS_FILE ?? 'analytics-dashboard/data/latest.json');
}
export function hostOf(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const url = new URL(value.includes('://') ? value : `https://${value}`);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.hostname.toLowerCase() : null;
  } catch { return null; }
}
type Totals = Record<string, number | null>;
export type PortfolioSite = { name: string; host: string; error: boolean; gsc: { current: Totals | null; previous: Totals | null }; ga4: { current: Totals | null; previous: Totals | null } };
const record = (value: unknown): Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
function totals(value: unknown, keys: string[]): Totals | null {
  if (!value || typeof value !== 'object') return null;
  const row = record(value);
  return Object.fromEntries(keys.map(key => [key, typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0 ? row[key] : null]));
}
function date(value: unknown) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null; }
export async function readPortfolio() {
  try {
    const path = portfolioPath();
    if ((await stat(path)).size > 10_000_000) throw new Error('Snapshot too large');
    const raw = record(JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')));
    if (!Array.isArray(raw.sites) || raw.sites.length > 1000) throw new Error('Invalid sites');
    const generatedAt = typeof raw.generatedAt === 'string' && Number.isFinite(Date.parse(raw.generatedAt)) ? raw.generatedAt : null;
    const p = record(raw.period);
    const period = { start: date(p.start), end: date(p.end), previousStart: date(p.previousStart), previousEnd: date(p.previousEnd) };
    const days = (a: string | null, b: string | null) => a && b ? (Date.parse(b) - Date.parse(a)) / 86400000 + 1 : 0;
    const comparable = days(period.start, period.end) > 0 && days(period.start, period.end) === days(period.previousStart, period.previousEnd) && !!period.previousEnd && !!period.start && period.previousEnd < period.start;
    const stale = !generatedAt || Date.now() - Date.parse(generatedAt) > 3 * 86400000 || Date.parse(generatedAt) > Date.now() + 300000 || !period.end || Date.now() - Date.parse(period.end) > 7 * 86400000;
    const seen = new Set<string>();
    const sites: PortfolioSite[] = raw.sites.map((value: unknown) => {
      const s = record(value), host = hostOf(s.host);
      if (!host || seen.has(host)) throw new Error('Invalid or duplicate host');
      seen.add(host);
      const source = (key: string, fields: string[]) => ({ current: totals(record(record(s[key]).current).total, fields), previous: totals(record(record(s[key]).previous).total, fields) });
      return { name: typeof s.name === 'string' ? s.name.slice(0, 200) : host, host, error: !!s.error,
        gsc: source('gsc', ['clicks', 'impressions', 'ctr', 'position']), ga4: source('ga4', ['sessions', 'activeUsers', 'engagement', 'views']) };
    });
    return { status: 'available' as const, generatedAt, period, comparable, stale, sites, message: null };
  } catch (error) {
    return { status: 'unavailable' as const, generatedAt: null, period: null, comparable: false, stale: true, sites: [] as PortfolioSite[], message: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Analyticsの保存データがありません。dashboardの更新コマンドを実行してください。' : 'Analyticsの保存データを読み込めません。形式とアクセス権を確認してください。' };
  }
}
