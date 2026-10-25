// Read-only adapter for nomuonji/api `/api/keyword-suggest`: expands seeds through
// Google / YouTube autocomplete (kana / alphabet / intent suffixes) and optionally
// Google Ads keyword ideas. No credentials live on this side.

export type KeywordSuggestSource = 'google' | 'youtube' | 'ads';

export type KeywordSuggestion = {
  keyword: string;
  sources: KeywordSuggestSource[];
  hits: number;
  bestRank: number;
  via: string[];
  avgMonthlySearches?: number | null;
  competitionIndex?: number | null;
  competitionLevel?: string | null;
};

export type KeywordSuggestInput = {
  seeds: string[];
  sources?: KeywordSuggestSource[];
  expand?: 'none' | 'kana' | 'alphabet' | 'full';
  modifierPreset?: 'intent_ja' | 'intent_en';
  modifiers?: string[];
  includeVolumes?: boolean;
  hl?: string;
  gl?: string;
  languageConstant?: string;
  geoTargetConstants?: string[];
};

export type KeywordSuggestResult = {
  provider: 'keyword_suggest';
  fetchedAt: string;
  seeds: string[];
  sources: KeywordSuggestSource[];
  expand: string;
  count: number;
  warnings: string[];
  autocomplete: unknown;
  ads: unknown;
  suggestions: KeywordSuggestion[];
};

export function keywordSuggestUrl(env: Record<string, string | undefined> = process.env) {
  const explicit = env.KEYWORD_SUGGEST_API_URL?.trim();
  if (explicit) return explicit;
  // Default: same nomuonji/api deployment that serves the Google Ads proxy.
  const demand = env.GOOGLE_ADS_KEYWORD_VOLUME_API_URL?.trim() || env.KEYWORDS_KEYWORD_VOLUME_API_URL?.trim() || env.KEYWORD_VOLUME_API_URL?.trim();
  if (!demand) return null;
  try {
    return `${new URL(demand).origin}/api/keyword-suggest`;
  } catch {
    return null;
  }
}

export function keywordSuggestConfiguration() {
  const url = keywordSuggestUrl();
  let target: string | null = null;
  if (url) {
    try { const parsed = new URL(url); target = `${parsed.origin}${parsed.pathname}`; } catch { target = 'invalid_url'; }
  }
  return { configured: Boolean(url), target, source: process.env.KEYWORD_SUGGEST_API_URL?.trim() ? 'KEYWORD_SUGGEST_API_URL' : 'derived_from_google_ads_proxy_origin' };
}

const SOURCES = new Set(['google', 'youtube', 'ads']);

function normalizeSuggestion(raw: any): KeywordSuggestion | null {
  if (typeof raw?.keyword !== 'string' || !raw.keyword.trim()) return null;
  const numeric = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    keyword: raw.keyword,
    sources: (Array.isArray(raw.sources) ? raw.sources : []).filter((source: unknown): source is KeywordSuggestSource => SOURCES.has(String(source))),
    hits: Number(raw.hits) || 0,
    bestRank: Number(raw.bestRank) || 0,
    via: (Array.isArray(raw.via) ? raw.via : []).filter((item: unknown): item is string => typeof item === 'string').slice(0, 3),
    ...(raw.avgMonthlySearches !== undefined ? { avgMonthlySearches: numeric(raw.avgMonthlySearches) } : {}),
    ...(raw.competitionIndex !== undefined ? { competitionIndex: numeric(raw.competitionIndex) } : {}),
    ...(raw.competitionLevel !== undefined ? { competitionLevel: typeof raw.competitionLevel === 'string' ? raw.competitionLevel : null } : {})
  };
}

export async function keywordSuggest(input: KeywordSuggestInput, fetcher: typeof fetch = fetch): Promise<KeywordSuggestResult> {
  const url = keywordSuggestUrl();
  if (!url) throw new Error('Keyword suggest proxy is not configured (set KEYWORD_SUGGEST_API_URL or GOOGLE_ADS_KEYWORD_VOLUME_API_URL)');
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(90_000)
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error.slice(0, 300) : '';
    const warnings = Array.isArray(body?.warnings) ? ` | ${body.warnings.slice(0, 3).join(' ; ').slice(0, 300)}` : '';
    throw new Error(`Keyword suggest proxy failed (${response.status}${message ? ` | ${message}` : ''}${warnings})`);
  }
  const suggestions = (Array.isArray(body?.suggestions) ? body.suggestions : []).map(normalizeSuggestion).filter((item: KeywordSuggestion | null): item is KeywordSuggestion => Boolean(item));
  return {
    provider: 'keyword_suggest',
    fetchedAt: typeof body?.fetchedAt === 'string' ? body.fetchedAt : new Date().toISOString(),
    seeds: Array.isArray(body?.seeds) ? body.seeds : input.seeds,
    sources: Array.isArray(body?.sources) ? body.sources : input.sources ?? ['google'],
    expand: typeof body?.expand === 'string' ? body.expand : input.expand ?? 'kana',
    count: suggestions.length,
    warnings: Array.isArray(body?.warnings) ? body.warnings.map(String) : [],
    autocomplete: body?.autocomplete ?? null,
    ads: body?.ads ?? null,
    suggestions
  };
}
