// Read-only adapter for nomuonji/api `/api/bing-keyword-stats` (Bing Webmaster GetKeywordStats).
// The Bing API key lives only on that proxy; this side needs just its URL.

export type BingKeywordStat = {
  keyword: string;
  status: 'ok' | 'no_data' | 'error';
  weeks: number;
  firstWeek: string | null;
  lastWeek: string | null;
  monthlyImpressions: number | null;
  monthlyBroadImpressions: number | null;
  recentMonthlyImpressions: number | null;
  error?: string;
};

export type BingKeywordStatsResult = {
  provider: 'bing_webmaster_keyword_stats';
  country: string;
  language: string;
  fetchedAt: string;
  results: BingKeywordStat[];
};

const MAX_PER_REQUEST = 50;

export function bingKeywordStatsUrl(env: Record<string, string | undefined> = process.env) {
  const explicit = env.BING_KEYWORD_STATS_API_URL?.trim();
  if (explicit) return explicit;
  // Default: same nomuonji/api deployment that serves the Google Ads proxy.
  const demand = env.GOOGLE_ADS_KEYWORD_VOLUME_API_URL?.trim() || env.KEYWORDS_KEYWORD_VOLUME_API_URL?.trim() || env.KEYWORD_VOLUME_API_URL?.trim();
  if (!demand) return null;
  try {
    return `${new URL(demand).origin}/api/bing-keyword-stats`;
  } catch {
    return null;
  }
}

export function bingKeywordStatsConfiguration() {
  const url = bingKeywordStatsUrl();
  let target: string | null = null;
  if (url) {
    try { const parsed = new URL(url); target = `${parsed.origin}${parsed.pathname}`; } catch { target = 'invalid_url'; }
  }
  return { configured: Boolean(url), target, source: process.env.BING_KEYWORD_STATS_API_URL?.trim() ? 'BING_KEYWORD_STATS_API_URL' : 'derived_from_google_ads_proxy_origin' };
}

function normalizeStat(raw: any): BingKeywordStat | null {
  const keyword = typeof raw?.keyword === 'string' ? raw.keyword : null;
  if (!keyword) return null;
  const numeric = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null);
  const status = raw?.status === 'ok' || raw?.status === 'no_data' ? raw.status : 'error';
  return {
    keyword,
    status,
    weeks: Number(raw?.weeks) || 0,
    firstWeek: typeof raw?.firstWeek === 'string' ? raw.firstWeek : null,
    lastWeek: typeof raw?.lastWeek === 'string' ? raw.lastWeek : null,
    monthlyImpressions: numeric(raw?.monthlyImpressions),
    monthlyBroadImpressions: numeric(raw?.monthlyBroadImpressions),
    recentMonthlyImpressions: numeric(raw?.recentMonthlyImpressions),
    ...(typeof raw?.error === 'string' ? { error: raw.error.slice(0, 300) } : {})
  };
}

export async function bingKeywordStats(input: { keywords: string[]; country?: string; language?: string }): Promise<BingKeywordStatsResult> {
  const url = bingKeywordStatsUrl();
  if (!url) throw new Error('Bing keyword stats proxy is not configured (set BING_KEYWORD_STATS_API_URL or GOOGLE_ADS_KEYWORD_VOLUME_API_URL)');
  const keywords = [...new Set((input.keywords ?? []).map(keyword => keyword.trim()).filter(Boolean))];
  if (!keywords.length) throw new Error('keywords must contain at least one value');
  const country = (input.country ?? 'jp').toLowerCase();
  const language = input.language ?? 'ja-JP';

  const results: BingKeywordStat[] = [];
  for (let offset = 0; offset < keywords.length; offset += MAX_PER_REQUEST) {
    const chunk = keywords.slice(offset, offset + MAX_PER_REQUEST);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ keywords: chunk, country, language }),
      signal: AbortSignal.timeout(60_000)
    });
    const body = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
      const message = typeof body?.error === 'string' ? body.error.slice(0, 300) : '';
      throw new Error(`Bing keyword stats proxy failed (${response.status}${message ? ` | ${message}` : ''})`);
    }
    for (const raw of Array.isArray(body?.results) ? body.results : []) {
      const stat = normalizeStat(raw);
      if (stat) results.push(stat);
    }
  }

  return { provider: 'bing_webmaster_keyword_stats', country, language, fetchedAt: new Date().toISOString(), results };
}
