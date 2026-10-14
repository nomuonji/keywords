import { createHash } from 'node:crypto';
import { z } from 'zod';

const OBSERVATIONS_URL = 'https://raw.githubusercontent.com/nomuonji/keywords/market-data/data/latest.json';
const RANKING_URL = 'https://api-three-gilt-37.vercel.app/api/affiliate';
const MAX_BODY_BYTES = 1_500_000;

export const marketProductDiscoveryShape = {
  mode: z.enum(['discover', 'overview']).optional(),
  maxCategories: z.number().int().min(1).max(8).optional(),
  productsPerCategory: z.number().int().min(1).max(5).optional(),
  rotation: z.number().int().min(0).max(50).optional(),
  genreIds: z.array(z.string().regex(/^\d{1,12}$/)).max(8).optional()
};
type Input = {
  mode?: 'discover' | 'overview';
  maxCategories?: number;
  productsPerCategory?: number;
  rotation?: number;
  genreIds?: string[];
};
type RankItem = { itemCode: string; rank: number; itemName?: string; itemUrl?: string };
type Observed = {
  date: string;
  rootGenreId: string;
  rootName: string;
  genreId: string;
  genreName: string;
  selection: string;
  items: RankItem[];
};
type Snapshot = {
  schemaVersion: number;
  date: string;
  generatedAt: string;
  coverage?: { rootGenreCount?: number; sampledToday?: number };
  warnings?: { genreId?: string; reason?: string }[];
  observations: Observed[];
};
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const validGenre = (value: unknown) => typeof value === 'string' && /^\d{1,12}$/.test(value);
const stableUrl = (value: unknown) => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/(^|\.)rakuten\.co\.jp$/i.test(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
};
async function readJson(url: string, timeout: number): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw Error('HTTP ' + response.status);
  const reportedLength = Number(response.headers.get('content-length') || 0);
  if (reportedLength > MAX_BODY_BYTES) throw Error('response_too_large');
  const body = await response.text();
  if (body.length > MAX_BODY_BYTES) throw Error('response_too_large');
  return JSON.parse(body);
}
function validateSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== 'object') throw Error('invalid_observation_snapshot');
  const valueObj = value as Partial<Snapshot>;
  if (valueObj.schemaVersion !== 1 || !Array.isArray(valueObj.observations) || !/^\d{4}-\d\d-\d\d$/.test(valueObj.date || '')) {
    throw Error('invalid_observation_snapshot');
  }
  return valueObj as Snapshot;
}
export async function marketProductDiscovery(input: Input = {}, dependencies: {
  load?: (url: string, timeout: number) => Promise<unknown>;
  clock?: () => number;
} = {}) {
  const load = dependencies.load ?? readJson;
  const now = dependencies.clock?.() ?? Date.now();
  const snapshotUrl = OBSERVATIONS_URL;
  let snapshot: Snapshot;
  try {
    snapshot = validateSnapshot(await load(snapshotUrl, 10000));
  } catch (error) {
    return {
      ok: false, status: 'observation_unavailable', snapshotUrl,
      error: error instanceof Error ? error.message : String(error),
      guidance: 'Observation data is unavailable; do not fall back to invented product names or AI-generated niches.'
    };
  }
  const ageHours = Math.max(0, Math.round((now - Date.parse(snapshot.generatedAt)) / 3600000));
  const maxCategories = input.maxCategories ?? 6;
  const productsPerCategory = input.productsPerCategory ?? 3;
  const mode = input.mode ?? 'discover';
  const rotation = input.rotation ?? 0;
  const all = snapshot.observations.filter((row) =>
    row && validGenre(row.genreId) && validGenre(row.rootGenreId) && typeof row.date === 'string' &&
    typeof row.genreName === 'string' && Array.isArray(row.items)
  );
  const latestByGenre = new Map<string, Observed>();
  for (const row of all) {
    const previous = latestByGenre.get(row.genreId);
    if (!previous || row.date >= previous.date) latestByGenre.set(row.genreId, row);
  }
  let possible = [...latestByGenre.values()];
  if (input.genreIds?.length) {
    const permitted = new Set(input.genreIds);
    possible = possible.filter(row => permitted.has(row.genreId));
  } else {
    const dates = possible.map(row => row.date).sort();
    const latestDate = dates[dates.length - 1] || '';
    possible = possible.filter(row => row.date === latestDate);
  }
  // Stable, reproducible rotation across the *observed* universe, never a model-selected niche.
  // First pass picks distinct top-level consumer markets. This prevents a popular root dominating.
  possible.sort((a, b) => sha(snapshot.date + ':' + a.genreId).localeCompare(sha(snapshot.date + ':' + b.genreId)));
  if (rotation && possible.length) {
    const offset = rotation % possible.length;
    possible = [...possible.slice(offset), ...possible.slice(0, offset)];
  }
  const selected: Observed[] = [];
  const chosenRoots = new Set<string>();
  for (const row of possible) {
    if (!chosenRoots.has(row.rootGenreId) && selected.length < maxCategories) {
      selected.push(row); chosenRoots.add(row.rootGenreId);
    }
  }
  for (const row of possible) {
    if (selected.length >= maxCategories) break;
    if (!selected.includes(row)) selected.push(row);
  }
  const report = {
    ok: true,
    status: ageHours > 168 ? 'stale_observations' : 'observations_available',
    source: { kind: 'rakuten_category_rank_observation', snapshotUrl, date: snapshot.date, generatedAt: snapshot.generatedAt, ageHours },
    universe: { availableCategories: possible.length, selectedCategories: selected.length, rootGenresObserved: new Set(all.map(row => row.rootGenreId)).size },
    guardrails: [
      'A category rank is a rank, not a disclosed sales count.',
      'Repeated appearance is not evidence of this publisher’s conversions.',
      'Product buyer, motive, search demand, review quality, margin, affiliate approval and purchase suitability are unverified.',
      'Do not call generic TikTok discovery first for product selection; validate independently selected concrete products after this observation.'
    ],
    resourceUse: { firestoreReads: 0, firestoreWrites: 0, serpCalls: 0, expectedRankingApiCalls: mode === 'discover' ? selected.length : 0 },
    warnings: [...(snapshot.warnings || []).slice(0,12)],
    categories: [] as any[]
  };
  const seenItems = new Set<string>();
  for (const row of selected) {
    const previous = all.filter(p => p.genreId === row.genreId && p.date < row.date).sort((a,b)=>b.date.localeCompare(a.date))[0];
    const previouslyRanked = new Map<string, number>((previous?.items || []).map(item => [item.itemCode, item.rank]));
    const category: any = {
      genreId: row.genreId, genreName: row.genreName,
      rootGenreId: row.rootGenreId, rootName: row.rootName,
      observationDate: row.date, observedRankCount: row.items.length,
      priorObservationDate: previous?.date ?? null,
      overlapWithPrevious: previous ? row.items.filter(item => previouslyRanked.has(item.itemCode)).length : null,
      selectionReason: input.genreIds?.length ? 'explicit_observed_genre' : 'category_stratified_rotation',
      items: [] as any[],
      status: mode === 'discover' ? 'pending_live_ranking' : 'observation_only'
    };
    if (mode === 'discover') {
      const url = new URL(RANKING_URL);
      url.searchParams.set('network', 'rakuten-ichiba');
      url.searchParams.set('action', 'ranking');
      url.searchParams.set('genreId', row.genreId);
      url.searchParams.set('count', String(Math.max(15, productsPerCategory)));
      try {
        const result = await load(url.toString(), 12000) as { items?: RankItem[]; lastBuildDate?: string };
        if (!Array.isArray(result?.items)) throw Error('ranking_items_missing');
        for (const item of [...result.items].filter(item => typeof item?.itemCode === 'string' && Number.isInteger(item.rank) && item.rank > 0).sort((a,b)=>a.rank-b.rank)) {
          if (category.items.length >= productsPerCategory) break;
          if (seenItems.has(item.itemCode)) continue;
          seenItems.add(item.itemCode);
          category.items.push({
            itemCode: item.itemCode,
            name: String(item.itemName || '').slice(0,200),
            rank: item.rank,
            sellerUrl: stableUrl(item.itemUrl),
            rankSourceUrl: url.toString(),
            previousRank: previouslyRanked.get(item.itemCode) ?? null,
            verification: 'rank_observed_only'
          });
        }
        category.status = category.items.length ? 'rank_observed' : 'no_eligible_ranked_items';
      } catch (error) {
        category.status = 'live_ranking_unavailable';
        category.warning = error instanceof Error ? error.message : String(error);
        report.warnings.push({ genreId: row.genreId, reason: 'live_ranking_unavailable' });
      }
    }
    report.categories.push(category);
  }
  return report;
}
