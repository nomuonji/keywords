import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_WEB_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 20_000;

function env(name: string, fallbackName?: string) {
  const value = process.env[name] ?? (fallbackName ? process.env[fallbackName] : undefined);
  if (!value) throw new Error(`Missing required environment variable: ${name}${fallbackName ? ` (or ${fallbackName})` : ''}`);
  return value;
}

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 2_000);
    throw new Error(`HTTP ${response.status} from ${url}: ${body}`);
  }
  return response.json() as Promise<T>;
}

function isPrivateIp(address: string) {
  const value = address.toLowerCase();
  if (value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true;
  if (isIP(value) !== 4) return false;
  const parts = value.split('.').map(Number);
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function assertSafePublicUrl(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http/https URLs are allowed');
  if (process.env.KEYWORDS_ALLOW_PRIVATE_FETCH === '1') return;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Private/local hosts are not allowed');
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Private/local IP addresses are not allowed');
    return;
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateIp(item.address))) throw new Error('URL resolves to a private/local address');
}

async function safeFetch(input: string, init: RequestInit = {}, redirects = 0): Promise<{ response: Response; finalUrl: string }> {
  if (redirects > 5) throw new Error('Too many redirects');
  const url = new URL(input);
  await assertSafePublicUrl(url);
  const response = await fetch(url, { ...init, redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw new Error(`Redirect without location from ${url.toString()}`);
    return safeFetch(new URL(location, url).toString(), init, redirects + 1);
  }
  return { response, finalUrl: url.toString() };
}

async function readLimitedText(response: Response, maxBytes = MAX_WEB_BYTES) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      reader.cancel().catch(() => undefined);
      throw new Error(`Response exceeded ${maxBytes} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

function decodeEntities(value: string) {
  return value
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));
}

function htmlText(html: string) {
  return decodeEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export interface WebDocument {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title: string | null;
  text: string;
  excerpt: string;
  fetchedAt: string;
}

export async function fetchWebDocument(input: { url: string; maxChars?: number }): Promise<WebDocument> {
  const { response, finalUrl } = await safeFetch(input.url, { headers: { 'user-agent': 'keywords-research/0.1 (+agent-native SEO workspace)' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${finalUrl}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml+xml')) throw new Error(`Unsupported content type: ${contentType || 'unknown'}`);
  const raw = await readLimitedText(response);
  const title = contentType.includes('html') ? decodeEntities(raw.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? '') || null : null;
  const text = contentType.includes('html') ? htmlText(raw) : raw.replace(/\s+/g, ' ').trim();
  const maxChars = Math.max(500, Math.min(input.maxChars ?? 20_000, 100_000));
  return { requestedUrl: input.url, finalUrl, status: response.status, contentType, title, text: text.slice(0, maxChars), excerpt: text.slice(0, 1_500), fetchedAt: new Date().toISOString() };
}

export interface SerpResult {
  position: number | null;
  title: string;
  link: string;
  snippet: string | null;
}

export interface SerpSnapshot {
  query: string;
  country: string | null;
  language: string | null;
  results: SerpResult[];
  peopleAlsoAsk: string[];
  relatedSearches: string[];
  fetchedAt: string;
}

export async function searchSerp(input: { query: string; country?: string; language?: string; location?: string; num?: number }): Promise<SerpSnapshot> {
  const apiKey = env('KEYWORDS_SERPER_API_KEY', 'SERPER_API_KEY');
  const endpoint = process.env.KEYWORDS_SERP_ENDPOINT ?? 'https://google.serper.dev/search';
  const payload: Record<string, unknown> = { q: input.query, num: Math.max(1, Math.min(input.num ?? 10, 100)) };
  if (input.country) payload.gl = input.country;
  if (input.language) payload.hl = input.language;
  if (input.location) payload.location = input.location;
  const raw = await jsonRequest<Record<string, any>>(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(payload)
  });
  const results = Array.isArray(raw.organic) ? raw.organic.map((item: any): SerpResult => ({
    position: typeof item.position === 'number' ? item.position : null,
    title: String(item.title ?? ''),
    link: String(item.link ?? ''),
    snippet: item.snippet ? String(item.snippet) : null
  })).filter((item: SerpResult) => item.title && item.link) : [];
  const peopleAlsoAsk = Array.isArray(raw.peopleAlsoAsk) ? raw.peopleAlsoAsk.map((item: any) => String(item.question ?? '')).filter(Boolean) : [];
  const relatedSearches = Array.isArray(raw.relatedSearches) ? raw.relatedSearches.map((item: any) => String(item.query ?? '')).filter(Boolean) : [];
  return { query: input.query, country: input.country ?? null, language: input.language ?? null, results, peopleAlsoAsk, relatedSearches, fetchedAt: new Date().toISOString() };
}

export interface GoogleAdsKeywordIdea {
  text: string;
  avgMonthly: number | null;
  competition: string | null;
  competitionIndex: number | null;
  lowTopOfPageBidMicros: number | null;
  highTopOfPageBidMicros: number | null;
}

export interface GoogleAdsKeywordIdeaResult {
  customerId: string;
  apiVersion: string;
  ideas: GoogleAdsKeywordIdea[];
  fetchedAt: string;
}

export async function googleAdsKeywordIdeas(input: {
  customerId?: string;
  seedKeywords?: string[];
  url?: string;
  languageId?: string;
  geoTargetIds?: string[];
  network?: 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS';
}): Promise<GoogleAdsKeywordIdeaResult> {
  const customerId = (input.customerId ?? process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replaceAll('-', '');
  if (!customerId) throw new Error('Google Ads customer ID is required (input.customerId or GOOGLE_ADS_CUSTOMER_ID)');
  const accessToken = env('GOOGLE_ADS_ACCESS_TOKEN', 'GOOGLE_OAUTH_ACCESS_TOKEN');
  const developerToken = env('GOOGLE_ADS_DEVELOPER_TOKEN');
  const apiVersion = process.env.GOOGLE_ADS_API_VERSION ?? 'v25';
  const seedKeywords = (input.seedKeywords ?? []).map(value => value.trim()).filter(Boolean);
  if (!seedKeywords.length && !input.url) throw new Error('At least one seed keyword or URL is required');
  const payload: Record<string, unknown> = {
    includeAdultKeywords: false,
    keywordPlanNetwork: input.network ?? 'GOOGLE_SEARCH'
  };
  const languageId = input.languageId ?? process.env.GOOGLE_ADS_LANGUAGE_ID;
  if (languageId) payload.language = `languageConstants/${languageId}`;
  const geoIds = input.geoTargetIds?.length ? input.geoTargetIds : (process.env.GOOGLE_ADS_GEO_TARGET_IDS?.split(',').map(value => value.trim()).filter(Boolean) ?? []);
  if (geoIds.length) payload.geoTargetConstants = geoIds.map(value => `geoTargetConstants/${value}`);
  if (seedKeywords.length && input.url) payload.keywordAndUrlSeed = { keywords: seedKeywords, url: input.url };
  else if (seedKeywords.length) payload.keywordSeed = { keywords: seedKeywords };
  else payload.urlSeed = { url: input.url };
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'content-type': 'application/json'
  };
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replaceAll('-', '');
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
  const raw = await jsonRequest<{ results?: any[] }>(`https://googleads.googleapis.com/${apiVersion}/customers/${customerId}:generateKeywordIdeas`, {
    method: 'POST', headers, body: JSON.stringify(payload)
  });
  const ideas = (raw.results ?? []).map((item: any): GoogleAdsKeywordIdea => {
    const metrics = item.keywordIdeaMetrics ?? {};
    return {
      text: String(item.text ?? ''),
      avgMonthly: typeof metrics.avgMonthlySearches === 'number' ? metrics.avgMonthlySearches : Number.isFinite(Number(metrics.avgMonthlySearches)) ? Number(metrics.avgMonthlySearches) : null,
      competition: metrics.competition ? String(metrics.competition) : null,
      competitionIndex: Number.isFinite(Number(metrics.competitionIndex)) ? Number(metrics.competitionIndex) : null,
      lowTopOfPageBidMicros: Number.isFinite(Number(metrics.lowTopOfPageBidMicros)) ? Number(metrics.lowTopOfPageBidMicros) : null,
      highTopOfPageBidMicros: Number.isFinite(Number(metrics.highTopOfPageBidMicros)) ? Number(metrics.highTopOfPageBidMicros) : null
    };
  }).filter(item => item.text);
  return { customerId, apiVersion, ideas, fetchedAt: new Date().toISOString() };
}

export interface SearchConsoleRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchConsoleResult {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
  rows: SearchConsoleRow[];
  fetchedAt: string;
}

export async function searchConsoleQuery(input: {
  siteUrl?: string;
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
  startRow?: number;
  searchType?: string;
}): Promise<SearchConsoleResult> {
  const accessToken = env('GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN', 'GOOGLE_OAUTH_ACCESS_TOKEN');
  const siteUrl = input.siteUrl ?? process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL;
  if (!siteUrl) throw new Error('Search Console site URL is required (input.siteUrl or GOOGLE_SEARCH_CONSOLE_SITE_URL)');
  const dimensions = input.dimensions?.length ? input.dimensions : ['query'];
  const body: Record<string, unknown> = {
    startDate: input.startDate,
    endDate: input.endDate,
    dimensions,
    rowLimit: Math.max(1, Math.min(input.rowLimit ?? 25_000, 25_000)),
    startRow: Math.max(0, input.startRow ?? 0)
  };
  if (input.searchType) body.type = input.searchType;
  const raw = await jsonRequest<{ rows?: any[] }>(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const rows = (raw.rows ?? []).map((row: any): SearchConsoleRow => ({
    keys: Array.isArray(row.keys) ? row.keys.map(String) : [],
    clicks: Number(row.clicks ?? 0),
    impressions: Number(row.impressions ?? 0),
    ctr: Number(row.ctr ?? 0),
    position: Number(row.position ?? 0)
  }));
  return { siteUrl, startDate: input.startDate, endDate: input.endDate, dimensions, rows, fetchedAt: new Date().toISOString() };
}
