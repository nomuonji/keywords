import { createHash } from 'node:crypto';
// Relative .js imports also resolve after Vercel transpiles workspace sources.
import { firestore, field, value } from '../../db/src/firestore.js';

export type TreasuryCandidate = {
  keyword: string;
  seed?: string;
  status?: 'inbox' | 'shortlisted' | 'rejected' | 'published';
  notes?: string;
  volume?: number | null;
  competition?: string | number | null;
  allintitle?: number | null;
  serpWeakness?: number | null;
  source?: string;
  evidence?: Record<string, unknown>;
};

export type TreasuryItem = TreasuryCandidate & { id: string; createdAt: string; updatedAt: string };

function demandProviderUrl() { return process.env.GOOGLE_ADS_KEYWORD_VOLUME_API_URL?.trim() || process.env.KEYWORDS_KEYWORD_VOLUME_API_URL?.trim() || process.env.KEYWORD_VOLUME_API_URL?.trim() || ''; }
function demandProviderTarget() {
  const raw = demandProviderUrl();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return 'invalid_url';
  }
}

function normalize(keyword: string) { return keyword.trim().replace(/\s+/g, ' ').toLowerCase(); }
function idFor(keyword: string) { return createHash('sha256').update(normalize(keyword)).digest('hex').slice(0, 32); }
function document(item: TreasuryCandidate, id: string, createdAt: string) {
  const now = new Date().toISOString();
  return { fields: Object.fromEntries(Object.entries({ ...item, keyword: item.keyword.trim(), status: item.status ?? 'inbox', source: item.source ?? 'remote_mcp', createdAt, updatedAt: now }).map(([key, item]) => [key, field(item)])) };
}
function parseDocument(doc: any): TreasuryItem {
  const id = String(doc.name ?? '').split('/').pop() ?? '';
  return { id, ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)])) } as TreasuryItem;
}

export async function treasurySave(input: TreasuryCandidate[]) {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error('candidates must contain 1–100 items');
  const saved: TreasuryItem[] = [];
  for (const candidate of input) {
    if (!candidate?.keyword?.trim()) throw new Error('Every candidate requires keyword');
    const id = idFor(candidate.keyword);
    let existing: any;
    try { existing = await firestore(`/keywordTreasury/${id}`); } catch { existing = undefined; }
    const createdAt = existing ? String(value(existing.fields?.createdAt) ?? new Date().toISOString()) : new Date().toISOString();
    const result = await firestore(`/keywordTreasury/${id}`, { method: 'PATCH', body: JSON.stringify(document(candidate, id, createdAt)) });
    saved.push(parseDocument(result));
  }
  return saved;
}

export async function treasuryList(input: { status?: string; limit?: number; query?: string } = {}) {
  const response = await firestore(`/keywordTreasury?pageSize=100`);
  const query = input.query?.trim().toLowerCase();
  const items = (response.documents ?? []).map(parseDocument).filter((item: TreasuryItem) => (!input.status || item.status === input.status) && (!query || item.keyword.toLowerCase().includes(query) || item.seed?.toLowerCase().includes(query))).sort((a: TreasuryItem, b: TreasuryItem) => b.updatedAt.localeCompare(a.updatedAt));
  return items.slice(0, Math.max(1, Math.min(input.limit ?? 50, 100)));
}

export async function keywordDemand(input: { keywords: string[]; languageConstant?: string; geoTargetConstants?: string[]; includeAdultKeywords?: boolean }) {
  const url = demandProviderUrl();
  if (!url) throw new Error('Missing GOOGLE_ADS_KEYWORD_VOLUME_API_URL for remote keyword-demand research');
  const keywords = [...new Set((input.keywords ?? []).map(keyword => keyword.trim()).filter(Boolean))];
  if (!keywords.length || keywords.length > 50) throw new Error('keywords must contain 1–50 values');
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keywords, options: { languageConstant: input.languageConstant ?? '1005', geoTargetConstants: input.geoTargetConstants ?? ['2392'], includeAdultKeywords: input.includeAdultKeywords ?? true } }) });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({})) as any;
    const codes = Array.isArray(errorBody?.googleAdsErrorCodes) ? errorBody.googleAdsErrorCodes.filter((value: unknown) => typeof value === 'string').join(',') : '';
    const providerError = typeof errorBody?.error === 'string' ? errorBody.error.replace(/https?:\/\/\S+/gi, '[url]').replace(/\b\d{10,}\b/g, '[id]').slice(0, 300) : null;
    const detail = [
      typeof errorBody?.googleAdsStatus === 'string' ? errorBody.googleAdsStatus : null,
      codes || null,
      typeof errorBody?.googleAdsMessage === 'string' ? errorBody.googleAdsMessage : null,
      providerError,
      typeof errorBody?.requestId === 'string' ? `requestId=${errorBody.requestId}` : null
    ].filter(Boolean).join(' | ');
    throw new Error(`Keyword-volume provider failed (${response.status}${detail ? ` | ${detail}` : ''})`);
  }
  const raw = await response.json() as Record<string, any>;
  const numeric = (value: unknown) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const monthly = (value: unknown) => Array.isArray(value) ? value.map((item: any) => ({ year: numeric(item.year), month: numeric(item.month), searches: numeric(item.monthlySearches ?? item.searches) })).filter((item): item is { year: number; month: number; searches: number } => item.year !== null && item.month !== null && item.searches !== null) : [];
  const values = Array.isArray(raw) ? raw : Array.isArray(raw.results) ? raw.results : Object.values(raw);
  return {
    provider: 'google_ads_keyword_volume_proxy',
    fetchedAt: new Date().toISOString(),
    results: values.map((item: any) => ({
      keyword: String(item.keyword ?? item.keywordText ?? item.text ?? ''),
      avgMonthlySearches: numeric(item.avgMonthlySearches ?? item.avg_monthly_searches),
      monthlySearchVolumes: monthly(item.monthlySearchVolumes ?? item.monthly_search_volumes),
      competition: item.competition ?? item.competitionLevel ?? null,
      competitionIndex: numeric(item.competitionIndex ?? item.competition_index),
      averageCpcMicros: numeric(item.averageCpcMicros ?? item.average_cpc_micros),
      lowTopOfPageBidMicros: numeric(item.lowTopOfPageBidMicros ?? item.low_top_of_page_bid_micros),
      highTopOfPageBidMicros: numeric(item.highTopOfPageBidMicros ?? item.high_top_of_page_bid_micros)
    })).filter(item => item.keyword)
  };
}

export function treasuryConfiguration() { return { firestoreConfigured: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_BASE64), projectConfigured: Boolean(process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID), demandProviderConfigured: Boolean(demandProviderUrl()), demandProviderTarget: demandProviderTarget(), braveConfigured: Boolean(process.env.BRAVE_API_KEY || process.env.KEYWORDS_BRAVE_API_KEY) }; }
