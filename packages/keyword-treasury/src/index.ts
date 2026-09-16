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
  avgMonthlySearches?: number | null;
  averageCpcMicros?: number | null;
  competitionIndex?: number | null;
  opportunityScore?: number | null;
  weakDomainCount?: number | null;
  forumCount?: number | null;
  stalePageCount?: number | null;
  exactTitleCount?: number | null;
  demandResearchedAt?: string | null;
  serpResearchedAt?: string | null;
  country?: string | null;
  language?: string | null;
};

export type TreasuryItem = TreasuryCandidate & { id: string; createdAt: string; updatedAt: string };

export type TreasurySearchInput = {
  query?: string;
  seed?: string;
  status?: TreasuryCandidate['status'];
  minVolume?: number;
  maxVolume?: number;
  minCpc?: number;
  maxCpc?: number;
  minCompetition?: number;
  maxCompetition?: number;
  minOpportunityScore?: number;
  linkedToSite?: boolean;
  researchedAfter?: string;
  researchedBefore?: string;
  sortBy?: 'updatedAt' | 'keyword' | 'avgMonthlySearches' | 'averageCpcMicros' | 'competitionIndex' | 'opportunityScore';
  sortOrder?: 'asc' | 'desc';
  pageToken?: string;
  limit?: number;
};

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
function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function metric(candidate: TreasuryCandidate, key: keyof TreasuryCandidate, evidenceKey = key): number | null | undefined {
  if (candidate[key] !== undefined) return finite(candidate[key]);
  const evidenceValue = candidate.evidence?.[String(evidenceKey)];
  return evidenceValue === undefined ? undefined : finite(evidenceValue);
}
function structured(candidate: TreasuryCandidate): TreasuryCandidate {
  return {
    ...candidate,
    avgMonthlySearches: metric(candidate, 'avgMonthlySearches') ?? (candidate.volume === undefined ? undefined : finite(candidate.volume)),
    averageCpcMicros: metric(candidate, 'averageCpcMicros'),
    competitionIndex: metric(candidate, 'competitionIndex') ?? (typeof candidate.competition === 'number' ? finite(candidate.competition) : undefined),
    opportunityScore: metric(candidate, 'opportunityScore'),
    weakDomainCount: metric(candidate, 'weakDomainCount'),
    forumCount: metric(candidate, 'forumCount'),
    stalePageCount: metric(candidate, 'stalePageCount'),
    exactTitleCount: metric(candidate, 'exactTitleCount'),
    demandResearchedAt: candidate.demandResearchedAt ?? (typeof candidate.evidence?.demandResearchedAt === 'string' ? candidate.evidence.demandResearchedAt : undefined),
    serpResearchedAt: candidate.serpResearchedAt ?? (typeof candidate.evidence?.serpResearchedAt === 'string' ? candidate.evidence.serpResearchedAt : undefined),
    country: candidate.country ?? (typeof candidate.evidence?.country === 'string' ? candidate.evidence.country : undefined),
    language: candidate.language ?? (typeof candidate.evidence?.language === 'string' ? candidate.evidence.language : undefined)
  };
}
function document(item: TreasuryCandidate, createdAt: string) {
  const now = new Date().toISOString();
  const payload = structured({ ...item, keyword: item.keyword.trim(), status: item.status ?? 'inbox', source: item.source ?? 'remote_mcp' });
  return { fields: Object.fromEntries(Object.entries({ ...payload, createdAt, updatedAt: now }).filter(([, item]) => item !== undefined).map(([key, item]) => [key, field(item)])) };
}
function parseDocument(doc: any): TreasuryItem {
  const id = String(doc.name ?? '').split('/').pop() ?? '';
  return structured({ id, ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)])) } as TreasuryItem) as TreasuryItem;
}

export async function treasurySave(input: TreasuryCandidate[]) {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error('candidates must contain 1–100 items');
  const saved: TreasuryItem[] = [];
  for (const candidate of input) {
    if (!candidate?.keyword?.trim()) throw new Error('Every candidate requires keyword');
    const id = idFor(candidate.keyword);
    let existing: any;
    try { existing = await firestore(`/keywordTreasury/${id}`); } catch { existing = undefined; }
    const previous = existing ? parseDocument(existing) : null;
    const createdAt = previous?.createdAt ?? new Date().toISOString();
    const merged: TreasuryCandidate = previous
      ? { ...previous, id: undefined, createdAt: undefined, updatedAt: undefined, ...candidate } as TreasuryCandidate
      : candidate;
    const result = await firestore(`/keywordTreasury/${id}`, { method: 'PATCH', body: JSON.stringify(document(merged, createdAt)) });
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

async function allCollection(path: string, maxItems: number) {
  const documents: any[] = [];
  let pageToken: string | undefined;
  while (documents.length < maxItems) {
    const params = new URLSearchParams({ pageSize: String(Math.min(100, maxItems - documents.length)) });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await firestore(`/${path}?${params}`);
    documents.push(...(response.documents ?? []));
    pageToken = response.nextPageToken;
    if (!pageToken) break;
  }
  return documents;
}

function searchOffset(token?: string) {
  if (!token) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as { offset?: unknown };
    const offset = Number(parsed.offset);
    if (!Number.isInteger(offset) || offset < 0) throw new Error('bad cursor');
    return offset;
  } catch { throw new Error('Invalid pageToken'); }
}
function cursor(offset: number) { return Buffer.from(JSON.stringify({ offset })).toString('base64url'); }
function dateMetric(item: TreasuryItem) { return item.serpResearchedAt ?? item.demandResearchedAt ?? item.updatedAt; }

export async function treasurySearch(input: TreasurySearchInput = {}) {
  const maxScan = Math.max(100, Math.min(Number(process.env.KEYWORDS_TREASURY_SEARCH_SCAN_LIMIT ?? 2000) || 2000, 5000));
  const documents = await allCollection('keywordTreasury', maxScan);
  const siteDocuments = input.linkedToSite === undefined ? [] : await allCollection('siteStructures', 1000);
  const linked = new Map<string, Set<string>>();
  for (const doc of siteDocuments) {
    const siteId = String(doc.name ?? '').split('/').pop() ?? '';
    const fields = Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)])) as any;
    for (const node of Array.isArray(fields.nodes) ? fields.nodes : []) {
      for (const keywordId of Array.isArray(node?.keywordIds) ? node.keywordIds : []) {
        const set = linked.get(String(keywordId)) ?? new Set<string>();
        set.add(siteId); linked.set(String(keywordId), set);
      }
    }
  }
  const query = input.query?.trim().toLowerCase();
  const seed = input.seed?.trim().toLowerCase();
  const after = input.researchedAfter ? Date.parse(input.researchedAfter) : null;
  const before = input.researchedBefore ? Date.parse(input.researchedBefore) : null;
  if (input.researchedAfter && !Number.isFinite(after)) throw new Error('researchedAfter must be an ISO date');
  if (input.researchedBefore && !Number.isFinite(before)) throw new Error('researchedBefore must be an ISO date');
  const withLinks = documents.map(parseDocument).map(item => ({ ...item, linkedSiteConceptIds: [...(linked.get(item.id) ?? [])] }));
  const filtered = withLinks.filter(item => {
    const volume = finite(item.avgMonthlySearches ?? item.volume);
    const cpc = finite(item.averageCpcMicros);
    const competition = finite(item.competitionIndex ?? (typeof item.competition === 'number' ? item.competition : null));
    const opportunity = finite(item.opportunityScore);
    const researched = Date.parse(dateMetric(item));
    return (!query || item.keyword.toLowerCase().includes(query) || item.seed?.toLowerCase().includes(query) || item.notes?.toLowerCase().includes(query))
      && (!seed || item.seed?.toLowerCase().includes(seed))
      && (!input.status || item.status === input.status)
      && (input.minVolume === undefined || (volume !== null && volume >= input.minVolume))
      && (input.maxVolume === undefined || (volume !== null && volume <= input.maxVolume))
      && (input.minCpc === undefined || (cpc !== null && cpc >= input.minCpc))
      && (input.maxCpc === undefined || (cpc !== null && cpc <= input.maxCpc))
      && (input.minCompetition === undefined || (competition !== null && competition >= input.minCompetition))
      && (input.maxCompetition === undefined || (competition !== null && competition <= input.maxCompetition))
      && (input.minOpportunityScore === undefined || (opportunity !== null && opportunity >= input.minOpportunityScore))
      && (input.linkedToSite === undefined || (item.linkedSiteConceptIds.length > 0) === input.linkedToSite)
      && (after === null || researched >= after)
      && (before === null || researched <= before);
  });
  const sortBy = input.sortBy ?? 'updatedAt';
  const direction = input.sortOrder === 'asc' ? 1 : -1;
  filtered.sort((a: any, b: any) => {
    const av = sortBy === 'keyword' || sortBy === 'updatedAt' ? String(a[sortBy] ?? '') : finite(a[sortBy]) ?? -Infinity;
    const bv = sortBy === 'keyword' || sortBy === 'updatedAt' ? String(b[sortBy] ?? '') : finite(b[sortBy]) ?? -Infinity;
    return av < bv ? -1 * direction : av > bv ? 1 * direction : 0;
  });
  const offset = searchOffset(input.pageToken);
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const items = filtered.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return { items, nextPageToken: nextOffset < filtered.length ? cursor(nextOffset) : null, matched: filtered.length, scanned: documents.length, truncated: documents.length >= maxScan };
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
