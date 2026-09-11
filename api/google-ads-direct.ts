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
const PROXY_GOOGLE_ADS_ACCOUNT = {
  customerId: '8154035223',
  loginCustomerId: '5790359570'
} as const;

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

type GoogleAdsAccountCandidate = {
  customerId: string;
  loginCustomerId?: string;
  source: 'configured' | 'proxy';
};

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedId(value: string | undefined) {
  return value?.replaceAll('-', '').trim() || undefined;
}

function normalizedKeyword(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
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

export function googleAdsDirectAccountCandidates(): GoogleAdsAccountCandidate[] {
  const configuredCustomerId = normalizedId(process.env.GOOGLE_ADS_CUSTOMER_ID ?? process.env.ADS_CUSTOMER_ID);
  const configuredLoginCustomerId = normalizedId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? process.env.ADS_LOGIN_CUSTOMER_ID);
  const candidates: GoogleAdsAccountCandidate[] = [];
  if (configuredCustomerId) {
    candidates.push({ customerId: configuredCustomerId, loginCustomerId: configuredLoginCustomerId, source: 'configured' });
  }
  const proxyAlreadyConfigured = configuredCustomerId === PROXY_GOOGLE_ADS_ACCOUNT.customerId
    && configuredLoginCustomerId === PROXY_GOOGLE_ADS_ACCOUNT.loginCustomerId;
  if (!proxyAlreadyConfigured) {
    candidates.push({ ...PROXY_GOOGLE_ADS_ACCOUNT, source: 'proxy' });
  }
  return candidates;
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
    configured: developerTokenConfigured && (accessTokenConfigured || refreshCredentialsConfigured),
    customerIdConfigured,
    developerTokenConfigured,
    loginCustomerIdConfigured,
    accessTokenConfigured,
    refreshCredentialsConfigured,
    proxyAccountRetryConfigured: true,
    keywordIdeasCompatibilityFallbackConfigured: true
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

function targeting(input: {
  languageId?: string;
  geoTargetIds?: string[];
  network?: 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS';
}) {
  const languageId = input.languageId ?? process.env.GOOGLE_ADS_LANGUAGE_ID ?? '1005';
  const geoIds = input.geoTargetIds?.length
    ? input.geoTargetIds
    : (process.env.GOOGLE_ADS_GEO_TARGET_IDS?.split(',').map(value => value.trim()).filter(Boolean) ?? ['2392']);
  return {
    language: `languageConstants/${languageId}`,
    geoTargetConstants: geoIds.map(value => `geoTargetConstants/${value}`),
    keywordPlanNetwork: input.network ?? 'GOOGLE_SEARCH'
  };
}

export function buildGoogleAdsHistoricalMetricsPayload(input: {
  keywords: string[];
  languageId?: string;
  geoTargetIds?: string[];
  network?: 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS';
}) {
  return {
    keywords: input.keywords,
    ...targeting(input),
    historicalMetricsOptions: { includeAverageCpc: true }
  };
}

export function buildGoogleAdsKeywordIdeasPayload(input: {
  keywords: string[];
  languageId?: string;
  geoTargetIds?: string[];
  network?: 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS';
  includeAdultKeywords?: boolean;
}) {
  return {
    ...targeting(input),
    includeAdultKeywords: input.includeAdultKeywords ?? false,
    keywordSeed: { keywords: input.keywords },
    historicalMetricsOptions: { includeAverageCpc: true },
    pageSize: 100
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

function googleAdsHeaders(account: GoogleAdsAccountCandidate, accessToken: string, developerToken: string) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'content-type': 'application/json'
  };
  if (account.loginCustomerId) headers['login-customer-id'] = account.loginCustomerId;
  return headers;
}

async function requestGoogleAdsHistoricalMetrics(input: {
  account: GoogleAdsAccountCandidate;
  accessToken: string;
  developerToken: string;
  apiVersion: string;
  payload: ReturnType<typeof buildGoogleAdsHistoricalMetricsPayload>;
}) {
  const response = await fetch(`https://googleads.googleapis.com/${input.apiVersion}/customers/${input.account.customerId}:generateKeywordHistoricalMetrics`, {
    method: 'POST',
    headers: googleAdsHeaders(input.account, input.accessToken, input.developerToken),
    body: JSON.stringify(input.payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(await googleAdsResponseError(response));
  const raw = await response.json() as { results?: unknown };
  return {
    provider: 'google_ads' as const,
    customerId: input.account.customerId,
    accountSource: input.account.source,
    apiMethod: 'generateKeywordHistoricalMetrics' as const,
    apiVersion: input.apiVersion,
    fetchedAt: new Date().toISOString(),
    results: normalizeGoogleAdsHistoricalResults(raw.results)
  };
}

async function requestGoogleAdsKeywordIdeas(input: {
  account: GoogleAdsAccountCandidate;
  accessToken: string;
  developerToken: string;
  apiVersion: string;
  payload: ReturnType<typeof buildGoogleAdsKeywordIdeasPayload>;
  requestedKeywords: string[];
}) {
  const response = await fetch(`https://googleads.googleapis.com/${input.apiVersion}/customers/${input.account.customerId}:generateKeywordIdeas`, {
    method: 'POST',
    headers: googleAdsHeaders(input.account, input.accessToken, input.developerToken),
    body: JSON.stringify(input.payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(await googleAdsResponseError(response));
  const raw = await response.json() as { results?: unknown };
  const normalized = normalizeGoogleAdsHistoricalResults(raw.results);
  const requested = new Set(input.requestedKeywords.map(normalizedKeyword));
  const exactResults = normalized.filter(item => requested.has(normalizedKeyword(item.keyword)));
  if (!exactResults.length) {
    throw new Error('Google Ads keyword ideas request returned no exact seed metrics');
  }
  return {
    provider: 'google_ads' as const,
    customerId: input.account.customerId,
    accountSource: input.account.source,
    apiMethod: 'generateKeywordIdeas' as const,
    apiVersion: input.apiVersion,
    fetchedAt: new Date().toISOString(),
    results: exactResults
  };
}

export async function googleAdsKeywordHistoricalMetricsDirect(input: {
  keywords: string[];
  languageId?: string;
  geoTargetIds?: string[];
  network?: 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS';
  includeAdultKeywords?: boolean;
}) {
  const keywords = [...new Set(input.keywords.map(value => value.trim()).filter(Boolean))];
  if (!keywords.length || keywords.length > 50) throw new Error('keywords must contain 1–50 values');
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? process.env.ADS_DEVELOPER_TOKEN;
  if (!developerToken) throw new Error('Google Ads direct developer token is not configured');
  const candidates = googleAdsDirectAccountCandidates();
  if (!candidates.length) throw new Error('Google Ads direct customer account is not configured');
  const accessToken = await googleAdsAccessToken();
  const historicalApiVersion = process.env.GOOGLE_ADS_API_VERSION ?? 'v25';
  const keywordIdeasApiVersion = process.env.GOOGLE_ADS_KEYWORD_IDEA_API_VERSION ?? 'v21';
  const historicalPayload = buildGoogleAdsHistoricalMetricsPayload({ ...input, keywords });
  let priorError: Error | null = null;

  for (const account of candidates) {
    try {
      return await requestGoogleAdsHistoricalMetrics({
        account,
        accessToken,
        developerToken,
        apiVersion: historicalApiVersion,
        payload: historicalPayload
      });
    } catch (historicalError) {
      const historical = historicalError instanceof Error ? historicalError : new Error(String(historicalError));
      if (!historical.message.includes('CUSTOMER_NOT_ENABLED')) {
        if (priorError) throw new Error(`${priorError.message}; ${account.source} account failed: ${historical.message}`);
        throw historical;
      }

      if (keywords.length <= 20) {
        try {
          return await requestGoogleAdsKeywordIdeas({
            account,
            accessToken,
            developerToken,
            apiVersion: keywordIdeasApiVersion,
            payload: buildGoogleAdsKeywordIdeasPayload({ ...input, keywords }),
            requestedKeywords: keywords
          });
        } catch (ideasError) {
          const ideas = ideasError instanceof Error ? ideasError : new Error(String(ideasError));
          priorError = new Error(`${historical.message}; generateKeywordIdeas compatibility fallback failed: ${ideas.message}`);
          continue;
        }
      }

      priorError = historical;
    }
  }

  throw priorError ?? new Error('Google Ads direct request failed');
}
