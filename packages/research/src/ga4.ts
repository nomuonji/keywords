import { createSign } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_ENDPOINT = 'https://analyticsdata.googleapis.com/v1beta';
const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export type Ga4MetricName = 'sessions' | 'activeUsers' | 'engagementRate' | 'screenPageViews';
export type Ga4Metrics = Record<Ga4MetricName, number | null>;

export interface Ga4ReportResult {
  propertyId: string;
  resourceName: string;
  startDate: string;
  endDate: string;
  metrics: Ga4Metrics;
  rowCount: number;
  fetchedAt: string;
}

export interface Ga4LandingPageRow {
  landingPage: string;
  metrics: Ga4Metrics;
}

export interface Ga4LandingPageReportResult {
  propertyId: string;
  resourceName: string;
  startDate: string;
  endDate: string;
  rows: Ga4LandingPageRow[];
  rowCount: number;
  complete: boolean;
  fetchedAt: string;
}

function refreshCredentials() {
  const refreshToken = process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN ?? process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_ANALYTICS_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_ADS_CLIENT_ID ?? process.env.ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ANALYTICS_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.GOOGLE_ADS_CLIENT_SECRET ?? process.env.ADS_CLIENT_SECRET;
  return refreshToken && clientId && clientSecret ? { refreshToken, clientId, clientSecret } : null;
}

export function ga4Configured() {
  return Boolean(
    process.env.GOOGLE_ANALYTICS_ACCESS_TOKEN ||
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
    refreshCredentials()
  );
}

export function normalizeGa4PropertyId(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(?:properties\/)?(\d+)$/);
  if (!match) throw new Error('GA4 property ID must be a numeric ID or properties/{id}');
  return match[1];
}

let serviceAccountCache: { path: string; modifiedAt: number; token: string; expiresAt: number } | null = null;
async function serviceAccountAccessToken() {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!credentialsPath) return null;
  const modifiedAt = statSync(credentialsPath).mtimeMs;
  if (serviceAccountCache?.path === credentialsPath && serviceAccountCache.modifiedAt === modifiedAt && serviceAccountCache.expiresAt > Date.now()) return serviceAccountCache.token;
  const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8')) as { client_email?: string; private_key?: string };
  if (!credentials.client_email || !credentials.private_key) throw new Error('Google service account JSON is missing client_email or private_key');
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: string) => Buffer.from(value).toString('base64url');
  const header = encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = encode(JSON.stringify({ iss: credentials.client_email, scope: ANALYTICS_SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const assertion = `${header}.${claim}.${signer.sign(credentials.private_key, 'base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth-grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const body = await response.json() as { access_token?: string };
  if (!response.ok || !body.access_token) throw new Error(`Google Analytics service-account token exchange failed (HTTP ${response.status})`);
  serviceAccountCache = { path: credentialsPath, modifiedAt, token: body.access_token, expiresAt: Date.now() + 50 * 60_000 };
  return body.access_token;
}

async function accessToken() {
  const configured = process.env.GOOGLE_ANALYTICS_ACCESS_TOKEN ?? process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  if (configured) return configured;
  const serviceAccountToken = await serviceAccountAccessToken();
  if (serviceAccountToken) return serviceAccountToken;
  const credentials = refreshCredentials();
  if (!credentials) throw new Error('Google Analytics OAuth credentials are required');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret, refresh_token: credentials.refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const body = await response.json() as { access_token?: string };
  if (!response.ok || !body.access_token) throw new Error(`Google Analytics OAuth token exchange failed (HTTP ${response.status})`);
  return body.access_token;
}

function numeric(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function assertDates(startDate: string, endDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('GA4 dates must use YYYY-MM-DD');
  if (Date.parse(`${startDate}T00:00:00Z`) > Date.parse(`${endDate}T00:00:00Z`)) throw new Error('GA4 startDate must be on or before endDate');
}

const metricNames: Ga4MetricName[] = ['sessions', 'activeUsers', 'engagementRate', 'screenPageViews'];
function metricsFromRow(headers: Array<{ name?: string }>, values: Array<{ value?: string }>) {
  const byName = new Map(headers.map((header, index) => [String(header.name ?? ''), numeric(values[index]?.value)]));
  return Object.fromEntries(metricNames.map(name => [name, byName.has(name) ? byName.get(name)! : null])) as Ga4Metrics;
}

async function runReport(input: { propertyId: string; body: Record<string, unknown> }) {
  const propertyId = normalizeGa4PropertyId(input.propertyId);
  const resourceName = `properties/${propertyId}`;
  const token = await accessToken();
  const endpoint = (process.env.GOOGLE_ANALYTICS_DATA_API_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/+$/, '');
  const response = await fetch(`${endpoint}/${resourceName}:runReport`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(input.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`GA4 Data API request failed (HTTP ${response.status})`);
  const raw = await response.json() as {
    dimensionHeaders?: Array<{ name?: string }>;
    metricHeaders?: Array<{ name?: string }>;
    rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>;
    rowCount?: number;
  };
  return { propertyId, resourceName, raw };
}

/** Direct GA4 site-total acquisition. No secret values are returned or logged. */
export async function ga4RunReport(input: { propertyId: string; startDate: string; endDate: string }): Promise<Ga4ReportResult> {
  assertDates(input.startDate, input.endDate);
  const { propertyId, resourceName, raw } = await runReport({
    propertyId: input.propertyId,
    body: {
      dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
      metrics: metricNames.map(name => ({ name })),
      limit: '1'
    }
  });
  const headers = raw.metricHeaders ?? [];
  const values = raw.rows?.[0]?.metricValues ?? [];
  return {
    propertyId,
    resourceName,
    startDate: input.startDate,
    endDate: input.endDate,
    metrics: metricsFromRow(headers, values),
    rowCount: Number(raw.rowCount ?? raw.rows?.length ?? 0),
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Bounded landing-page acquisition for exact article mapping. `landingPage` is
 * the path of the first pageview in the session; query strings are deliberately
 * excluded so canonical article identity can be matched without URL-parameter noise.
 */
export async function ga4RunLandingPageReport(input: { propertyId: string; startDate: string; endDate: string; maxRows?: number }): Promise<Ga4LandingPageReportResult> {
  assertDates(input.startDate, input.endDate);
  const maxRows = Math.max(1, Math.min(Math.floor(input.maxRows ?? 25_000), 250_000));
  const { propertyId, resourceName, raw } = await runReport({
    propertyId: input.propertyId,
    body: {
      dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
      dimensions: [{ name: 'landingPage' }],
      metrics: metricNames.map(name => ({ name })),
      dimensionFilter: {
        notExpression: { filter: { fieldName: 'landingPage', stringFilter: { value: '(not set)', matchType: 'EXACT' } } }
      },
      limit: String(maxRows),
      offset: '0'
    }
  });
  const metricHeaders = raw.metricHeaders ?? [];
  const rows = (raw.rows ?? []).flatMap(row => {
    const landingPage = String(row.dimensionValues?.[0]?.value ?? '').trim();
    if (!landingPage || landingPage === '(not set)') return [];
    return [{ landingPage, metrics: metricsFromRow(metricHeaders, row.metricValues ?? []) }];
  }).sort((a, b) => a.landingPage.localeCompare(b.landingPage));
  const rowCount = Number(raw.rowCount ?? rows.length);
  return {
    propertyId,
    resourceName,
    startDate: input.startDate,
    endDate: input.endDate,
    rows,
    rowCount,
    complete: Number.isFinite(rowCount) && rowCount <= rows.length,
    fetchedAt: new Date().toISOString()
  };
}
