import { createSign } from 'node:crypto';

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

const RETRYABLE_STATUS = new Set([429, 503]);
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30_000;

function retryAttempts() {
  const configured = Number(process.env.KEYWORDS_FIRESTORE_RETRY_ATTEMPTS ?? 3);
  return Number.isFinite(configured) ? Math.max(0, Math.min(Math.floor(configured), 10)) : 3;
}

function retryDelayMs(attempt: number, retryAfter: string | null) {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, Math.min(Math.floor(seconds * 1000), RETRY_MAX_DELAY_MS));
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), RETRY_MAX_DELAY_MS));
  }
  const backoff = RETRY_BASE_DELAY_MS * 2 ** attempt;
  return Math.min(backoff, RETRY_MAX_DELAY_MS) + Math.floor(Math.random() * 250);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function firestore(path: string, init?: RequestInit) {
  const attempts = retryAttempts();
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${baseUrl()}${path}`, { ...init, headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    if (response.ok) return response.json() as Promise<any>;
    // Throttling and transient unavailability are retried with backoff so bulk
    // onboarding/projection bursts survive quota bursts; local evidence never
    // depends on a single cloud attempt succeeding.
    if (!RETRYABLE_STATUS.has(response.status) || attempt >= attempts) throw new FirestoreError(response.status);
    await sleep(retryDelayMs(attempt, response.headers.get('retry-after')));
  }
}

export function field(value: unknown): any {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, field(item)])) } };
  return { stringValue: String(value) };
}
export function value(input: any): any {
  if ('stringValue' in input) return input.stringValue;
  if ('integerValue' in input) return Number(input.integerValue);
  if ('doubleValue' in input) return input.doubleValue;
  if ('booleanValue' in input) return input.booleanValue;
  if ('nullValue' in input) return null;
  if ('arrayValue' in input) return (input.arrayValue.values ?? []).map(value);
  if ('mapValue' in input) return Object.fromEntries(Object.entries(input.mapValue.fields ?? {}).map(([key, item]) => [key, value(item)]));
  return null;
}

export class FirestoreError extends Error {
  constructor(public readonly status: number) { super(`Firestore request failed (${status})`); }
}
export function firestoreDocumentName(path: string) { return `projects/${projectId()}/databases/(default)/documents/${path}`; }
