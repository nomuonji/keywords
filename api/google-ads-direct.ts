const MONTH_NUMBER: Record<string, number> = {
  JANUARY: 1,
  FEBRUARY: 2,
  MARCH: 3,
  APRIL: 4,
  MAY: 5,
  JUNE: 6,
  JULY: 7,
  AUGUST: 8,
  SEPTEMBER: 9,
  OCTOBER: 10,
  NOVEMBER: 11,
  DECEMBER: 12
};

const REQUEST_TIMEOUT_MS = 20_000;

type HistoricalMetric = {
  keyword: string;
  avgMonthlySearches: number | null;
  monthlySearchVolumes: Array<{ year: number; month: number; searches: number }>;
  competition: string | null;
  competitionIndex: number | null;
  averageCpcMicros: number | null;
  lowTopOfPageBidMicros: number | null;
  highTopOfPageBidMicros: number | null;
};

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function googleAdsMonthNumber(value: unknown): number | null {
  const numericMonth = numeric(value);
  if (numericMonth !== null && numericMonth >= 1 && numericMonth <= 12) return numericMonth;
  if (typeof value !== 'string') return null;
  return MONTH_NUMBER[value.trim().toUpperCase()] ?? null;
}

export function normalizeGoogleAdsHistoricalResults(value: unknown): HistoricalMetric[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: any): HistoricalMetric | null => {
    const metrics = item?.keywordMetrics ?? item?.keywordIdeaMetrics ?? {};
    const keyword = String(item?.text ?? '').trim();
    if (!keyword) return null;
    const monthlySearchVolumes = Array.isArray(metrics.monthlySearchVolumes)
      ? metrics.monthlySearchVolumes.map((month: any) => ({
          year: numeric(month?.year),
          month: googleAdsMonthNumber(month?.month),
          searches: numeric(month?.monthlySearches ?? month?.searches)
        })).filter((month: any): month is { year: number; month: number; searches: number } => month.year !== null && month.month !== null && month.searches !== null)
      : [];
    return {
      keyword,
      avgMonthlySearches: numeric(metrics.avgMonthlySearches),
      monthlySearchVolumes,
      competition: metrics.competition === null || metrics.competition === undefined ? null : String(metrics.competition),
      competitionIndex: numeric(metrics.competitionIndex),
      averageCpcMicros: numeric(metrics.averageCpcMicros),
      lowTopOfPageBidMicros: numeric(metrics.lowTopOfPageBidMicros),
      highTopOfPageBidMicros: numeric(metrics.highTopOfPageBidMicros)
    };
  }).filter((item: HistoricalMetric | null): item is HistoricalMetric => Boolean(item));
}

export function googleAdsDirectConfiguration() {
  const customerIdConfigured = Boolean(process.env.GOOGLE_ADS_CUSTOMER_ID || process.env.ADS_CUSTOMER_ID);
  const developerTokenConfigured = Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN || process.env.ADS_DEVELOPER_TOKEN);
  const loginCustomerIdConfigured = Boolean(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || process.env.ADS_LOGIN_CUSTOMER_ID);
  const accessTokenConfigured = Boolean(process.env.GOOGLE_ADS_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN);
  const refreshCredentialsConfigured = Boolean(
    (process.env.GOOGLE_ADS_REFRESH_TOKEN || process.env.ADS_REFRESH_TOKEN) &&
    (process.env.GOOGLE_ADS_CLIENT_ID || process.env.ADS_CLIENT_ID) &&
    (process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.ADS_CLIENT_SECRET)
  );
  return {
    configured: customerIdConfigured && developerTokenConfigured && (accessTokenConfigured || refreshCredentialsConfigured),
    customerIdConfigured,
    developerTokenConfigured,
    loginCustomerIdConfigured,
    accessTokenConfigured,
    refreshCredentialsConfigured
  };
}

function refreshCredentials() {
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN ?? process.env.ADS_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID ?? process.env.ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET ?? process.env.ADS_CLIENT_SECRET;
  return refreshToken && clientId && clientSecret ? { refreshToken, clientId, clientSecret } : null;
}

async function googleAdsAccessToken() {
  const configured = process.env.GOOGLE_ADS_ACCESS_TOKEN ?? process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  if (configured) return configured;
  const credentials = refreshCredentials();
  if (!credentials) throw new Error('Google Ads OAuth credentials are not configured');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token'
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(`Google OAuth token exchange failed (${response.status}${body.error ? ` ${body.error}` : ''}${body.error_description ? `: ${body.error_description}` : ''})`);
  }
  return body.access_token;
}

export function buildGoogleAdsHistoricalMetricsPayload(input: {
  keywords: string[];
  languageId?: string;
  geoTargetIds?: string[];
  network?: 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS';
}) {
  const languageId = input.languageId ?? process.env.GOOGLE_ADS_LANGUAGE_ID ?? '1005';
  const geoIds = input.geoTargetIds?.length
    ? input.geoTargetIds
    : (process.env.GOOGLE_ADS_GEO_TARGET_IDS?.split(',').map(value => value.trim()).filter(Boolean) ?? ['2392']);
  return {
    keywords: input.keywords,
    language: `languageConstants/${languageId}`,
    geoTargetConstants: geoIds.map(value => `geoTargetConstants/${value}`),
    keywordPlanNetwork: input.network ?? 'GOOGLE_SEARCH',
    historicalMetricsOptions: { includeAverageCpc: true }
  };
}

async function googleAdsResponseError(response: Response) {
  const body = await response.json().catch(() => ({})) as any;
  const status = typeof body?.error?.status === 'string' ? body.error.status : null;
  const message = typeof body?.error?.message === 'string' ? body.error.message : null;
  let adsErrorCode: string | null = null;
  let adsMessage: string | null = null;
  let requestId: string | null = null;
  for (const detail of Array.isArray(body?.error?.details) ? body.error.details : []) {
    if (!requestId && typeof detail?.requestId === 'string') requestId = detail.requestId;
    for (const failure of Array.isArray(detail?.errors) ? detail.errors : []) {
      if (!adsMessage && typeof failure?.message === 'string') adsMessage = failure.message;
      if (!adsErrorCode && failure?.errorCode && typeof failure.errorCode === 'object') {
        const code = Object.values(failure.errorCode).find(value => typeof value === 'string');
        if (typeof code === 'string') adsErrorCode = code;
      }
    }
  }
  const parts = [
    `${response.status}${status ? ` ${status}` : ''}`,
    adsErrorCode,
    adsMessage ?? message,
    requestId ? `requestId=${requestId}` : null
  ].filter(Boolean);
  return `Google Ads request failed (${parts.join(' | ')})`;
}

export function sanitizeGoogleAdsError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b\d{10,}\b/g, '[id]')
    .slice(0, 700);
}

export async function googleAdsKeywordHistoricalMetricsDirect(input: {
  keywords: string[];
  languageId?: string;
  geoTargetIds?: string[];
  network?: 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS';
}) {
  const keywords = [...new Set(input.keywords.map(value => value.trim()).filter(Boolean))];
  if (!keywords.length || keywords.length > 50) throw new Error('keywords must contain 1–50 values');
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? process.env.ADS_CUSTOMER_ID ?? '').replaceAll('-', '');
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? process.env.ADS_DEVELOPER_TOKEN;
  if (!customerId || !developerToken) throw new Error('Google Ads direct customer/developer credentials are not configured');
  const accessToken = await googleAdsAccessToken();
  const apiVersion = process.env.GOOGLE_ADS_API_VERSION ?? 'v25';
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'content-type': 'application/json'
  };
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? process.env.ADS_LOGIN_CUSTOMER_ID)?.replaceAll('-', '');
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
  const response = await fetch(`https://googleads.googleapis.com/${apiVersion}/customers/${customerId}:generateKeywordHistoricalMetrics`, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildGoogleAdsHistoricalMetricsPayload({ ...input, keywords })),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(await googleAdsResponseError(response));
  const raw = await response.json() as { results?: unknown };
  return {
    provider: 'google_ads' as const,
    customerId,
    apiVersion,
    fetchedAt: new Date().toISOString(),
    results: normalizeGoogleAdsHistoricalResults(raw.results)
  };
}
