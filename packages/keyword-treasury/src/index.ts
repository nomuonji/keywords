import { createHash, createSign } from 'node:crypto';

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

type ServiceAccount = { client_email?: string; private_key?: string; project_id?: string };
let tokenCache: { token: string; expiresAt: number } | undefined;

function env(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function serviceAccount(): ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? process.env.FIREBASE_SERVICE_ACCOUNT ?? (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8') : '');
  if (!raw) throw new Error('Missing Firebase service account configuration');
  try { return JSON.parse(raw) as ServiceAccount; } catch { throw new Error('Firebase service account JSON is invalid'); }
}

function base64url(value: string | Buffer) { return Buffer.from(value).toString('base64url'); }

async function accessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const account = serviceAccount();
  if (!account.client_email || !account.private_key) throw new Error('Firebase service account must include client_email and private_key');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const signer = createSign('RSA-SHA256'); signer.update(`${header}.${payload}`); signer.end();
  const assertion = `${header}.${payload}.${signer.sign(account.private_key).toString('base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if (!response.ok) throw new Error(`Firebase authentication failed (${response.status})`);
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Firebase authentication returned no access token');
  tokenCache = { token: body.access_token, expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000 };
  return tokenCache.token;
}

function projectId() { return process.env.FIREBASE_PROJECT_ID?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim() || process.env.GCP_PROJECT_ID?.trim() || serviceAccount().project_id || env('FIREBASE_PROJECT_ID'); }
function baseUrl() { return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId())}/databases/(default)/documents`; }

async function firestore(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl()}${path}`, { ...init, headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error(`Firestore request failed (${response.status})`);
  return response.json() as Promise<any>;
}

function field(value: unknown): any {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, field(item)])) } };
  return { stringValue: String(value) };
}
function value(input: any): any {
  if ('stringValue' in input) return input.stringValue;
  if ('integerValue' in input) return Number(input.integerValue);
  if ('doubleValue' in input) return input.doubleValue;
  if ('booleanValue' in input) return input.booleanValue;
  if ('nullValue' in input) return null;
  if ('arrayValue' in input) return (input.arrayValue.values ?? []).map(value);
  if ('mapValue' in input) return Object.fromEntries(Object.entries(input.mapValue.fields ?? {}).map(([key, item]) => [key, value(item)]));
  return null;
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
  const url = process.env.GOOGLE_ADS_KEYWORD_VOLUME_API_URL?.trim() || process.env.KEYWORDS_KEYWORD_VOLUME_API_URL?.trim() || process.env.KEYWORD_VOLUME_API_URL?.trim();
  if (!url) throw new Error('Missing GOOGLE_ADS_KEYWORD_VOLUME_API_URL for remote keyword-demand research');
  const keywords = [...new Set((input.keywords ?? []).map(keyword => keyword.trim()).filter(Boolean))];
  if (!keywords.length || keywords.length > 50) throw new Error('keywords must contain 1–50 values');
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keywords, options: { languageConstant: input.languageConstant ?? '1005', geoTargetConstants: input.geoTargetConstants ?? ['2392'], includeAdultKeywords: input.includeAdultKeywords ?? true } }) });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({})) as any;
    const codes = Array.isArray(errorBody?.googleAdsErrorCodes) ? errorBody.googleAdsErrorCodes.filter((value: unknown) => typeof value === 'string').join(',') : '';
    const detail = [
      typeof errorBody?.googleAdsStatus === 'string' ? errorBody.googleAdsStatus : null,
      codes || null,
      typeof errorBody?.googleAdsMessage === 'string' ? errorBody.googleAdsMessage : null,
      typeof errorBody?.requestId === 'string' ? `requestId=${errorBody.requestId}` : null
    ].filter(Boolean).join(' | ');
    throw new Error(`Keyword-volume provider failed (${response.status}${detail ? ` | ${detail}` : ''})`);
  }
  const raw = await response.json() as Record<string, any>;
  const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
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

export function treasuryConfiguration() { return { firestoreConfigured: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_BASE64), projectConfigured: Boolean(process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID), demandProviderConfigured: Boolean(process.env.GOOGLE_ADS_KEYWORD_VOLUME_API_URL || process.env.KEYWORDS_KEYWORD_VOLUME_API_URL || process.env.KEYWORD_VOLUME_API_URL), braveConfigured: Boolean(process.env.BRAVE_API_KEY || process.env.KEYWORDS_BRAVE_API_KEY) }; }
