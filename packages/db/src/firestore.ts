import { createSign } from 'node:crypto';

/**
 * Firestore REST client shared by Keywords Operator and Sites Operator.
 *
 * The two operators keep their data in separate Firebase projects, each with
 * its own free-tier read/write budget:
 *   keywords  FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_PROJECT_ID
 *   sites     SITES_FIREBASE_SERVICE_ACCOUNT_JSON / SITES_FIREBASE_PROJECT_ID
 *
 * Every request is routed by the collection it touches (see
 * SITES_FIRESTORE_COLLECTIONS), not by which endpoint called it, so
 * cross-operator reads (Sites reading a Site Concept in siteStructures,
 * Keywords reading a GSC planning digest) always reach the owning project.
 *
 * FIRESTORE_SINGLE_PROJECT=1 sends everything to the Keywords project. It
 * exists for tests and local development only; production must configure the
 * Sites project. See docs/firestore-project-split.md.
 */

export type FirestoreTarget = 'keywords' | 'sites';
type ServiceAccount = { client_email?: string; private_key?: string; project_id?: string };

/** Top-level collections owned by Sites Operator (all of their subcollections follow the parent). */
export const SITES_FIRESTORE_COLLECTIONS = [
  'sites',
  'articles',
  'optimizationEvents',
  'seoPlanningDigests',
  'siteDirections',
  'seoTasks',
  'growthInitiatives',
  'distributionExperiments',
  'seoRecoveryControls',
  'seoRecoverySites',
  'seoPortfolioPolicies',
  'indexationSnapshots',
  'indexationQuotaDays',
  'metricSnapshots',
] as const;
const SITES_OWNED = new Set<string>(SITES_FIRESTORE_COLLECTIONS);
/** Audit records are written in the same atomic commit as the records they describe, so they follow that commit's project. */
const FOLLOWS_COMMIT = new Set(['runs']);

function env(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function rawServiceAccount(target: FirestoreTarget) {
  if (target === 'sites') {
    return process.env.SITES_FIREBASE_SERVICE_ACCOUNT_JSON
      ?? (process.env.SITES_FIREBASE_SERVICE_ACCOUNT_BASE64 ? Buffer.from(process.env.SITES_FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8') : '');
  }
  return process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? process.env.FIREBASE_SERVICE_ACCOUNT ?? (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8') : '');
}

const accountCache = new Map<string, ServiceAccount>();
function serviceAccount(target: FirestoreTarget): ServiceAccount {
  const raw = rawServiceAccount(target)?.trim() ?? '';
  if (!raw) throw new Error(target === 'sites' ? 'Missing Sites Firebase service account configuration (SITES_FIREBASE_SERVICE_ACCOUNT_JSON)' : 'Missing Firebase service account configuration');
  const cached = accountCache.get(raw);
  if (cached) return cached;
  let parsed: ServiceAccount;
  try { parsed = JSON.parse(raw) as ServiceAccount; } catch { throw new Error(`${target === 'sites' ? 'Sites ' : ''}Firebase service account JSON is invalid`); }
  accountCache.set(raw, parsed);
  return parsed;
}

function base64url(value: string | Buffer) { return Buffer.from(value).toString('base64url'); }

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
async function accessToken(target: FirestoreTarget) {
  const account = serviceAccount(target);
  if (!account.client_email || !account.private_key) throw new Error('Firebase service account must include client_email and private_key');
  const cacheKey = `${account.client_email}|${projectIdFor(target)}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const signer = createSign('RSA-SHA256'); signer.update(`${header}.${payload}`); signer.end();
  const assertion = `${header}.${payload}.${signer.sign(account.private_key).toString('base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if (!response.ok) throw new Error(`Firebase authentication failed (${response.status})`);
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Firebase authentication returned no access token');
  tokenCache.set(cacheKey, { token: body.access_token, expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000 });
  return body.access_token;
}

export function projectIdFor(target: FirestoreTarget) {
  if (target === 'sites') return process.env.SITES_FIREBASE_PROJECT_ID?.trim() || serviceAccount('sites').project_id || env('SITES_FIREBASE_PROJECT_ID');
  return process.env.FIREBASE_PROJECT_ID?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim() || process.env.GCP_PROJECT_ID?.trim() || serviceAccount('keywords').project_id || env('FIREBASE_PROJECT_ID');
}
const documentsRoot = (target: FirestoreTarget) => `projects/${projectIdFor(target)}/databases/(default)/documents`;
function baseUrl(target: FirestoreTarget) { return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectIdFor(target))}/databases/(default)/documents`; }

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** Test/local-development mode: every collection lives in the Keywords project. */
export function singleFirestoreProject() {
  return /^(1|true|yes)$/i.test(process.env.FIRESTORE_SINGLE_PROJECT ?? '');
}

function sitesConfigurationError() {
  return rawServiceAccount('sites')?.trim() ? null : 'Sites Firebase project is not configured: set SITES_FIREBASE_SERVICE_ACCOUNT_JSON (or FIRESTORE_SINGLE_PROJECT=1 for tests and local development)';
}

export function collectionOwner(collectionId: string): FirestoreTarget {
  return SITES_OWNED.has(collectionId) ? 'sites' : 'keywords';
}

/** First collection id of a document/collection path such as "sites/a/indexationBundle/current" or a full document name. */
export function collectionOfPath(path: string) {
  let rest = path.split('?')[0];
  const marker = '/documents/';
  const at = rest.indexOf(marker);
  if (at >= 0) rest = rest.slice(at + marker.length);
  rest = rest.replace(/^\/+/, '');
  const first = rest.split('/')[0] ?? '';
  return first.split(':')[0];
}

function ownersOf(collections: string[]) {
  const owners = new Set<FirestoreTarget>();
  for (const collection of collections) if (collection && !FOLLOWS_COMMIT.has(collection)) owners.add(collectionOwner(collection));
  return owners;
}

function singleOwner(collections: string[], operation: string): FirestoreTarget {
  const owners = ownersOf(collections);
  if (owners.size > 1) throw new Error(`Firestore ${operation} mixes Sites and Keywords collections (${[...new Set(collections)].join(', ')}); they live in different projects and cannot share one request`);
  return owners.values().next().value ?? 'keywords';
}

function writeDocumentNames(writes: any[]) {
  return writes.map(write => write?.update?.name ?? write?.delete ?? write?.transform?.document ?? write?.verify).filter((name): name is string => typeof name === 'string');
}

function queryCollections(body: any) {
  const query = body?.structuredQuery ?? body?.structuredAggregationQuery?.structuredQuery;
  return (query?.from ?? []).map((from: any) => String(from?.collectionId ?? ''));
}

function parseBody(init?: RequestInit) {
  if (typeof init?.body !== 'string') return undefined;
  try { return JSON.parse(init.body); } catch { return undefined; }
}

/** Project that owns a request's collections. */
function ownerOfRequest(path: string, init?: RequestInit): FirestoreTarget {
  if (path.startsWith('/')) {
    const collection = collectionOfPath(path);
    // A collection-relative query such as "/sites/x:runQuery" is owned by the parent's collection.
    return collection ? collectionOwner(collection) : 'keywords';
  }
  const operation = path.split('?')[0];
  const body = parseBody(init);
  if (operation === ':commit' || operation === ':batchWrite') return singleOwner(writeDocumentNames(body?.writes ?? []).map(collectionOfPath), 'commit');
  if (operation === ':batchGet') return singleOwner((body?.documents ?? []).map((name: string) => collectionOfPath(name)), 'batchGet');
  if (operation === ':runQuery' || operation === ':runAggregationQuery') return singleOwner(queryCollections(body), 'query');
  return 'keywords';
}

/** Decide which project a request goes to. Exported for tests and diagnostics. */
export function routeFirestoreRequest(path: string, init?: RequestInit): FirestoreTarget {
  if (singleFirestoreProject()) return 'keywords';
  // Ownership is validated (mixed commits refused) before any network call.
  const owner = ownerOfRequest(path, init);
  if (owner === 'sites') {
    // Never fall back to the Keywords project for Sites data: that would split
    // Sites writes across two projects.
    const error = sitesConfigurationError();
    if (error) throw new Error(error);
  }
  return owner;
}

const NAME_PREFIX = /^projects\/[^/]+\/databases\/\(default\)\/documents/;
function retargetName(name: unknown, target: FirestoreTarget) {
  return typeof name === 'string' ? name.replace(NAME_PREFIX, documentsRoot(target)) : name;
}

/** Document names inside commit/batchGet bodies must carry the routed project id. */
function retargetBody(path: string, init: RequestInit | undefined, target: FirestoreTarget): RequestInit | undefined {
  const operation = path.split('?')[0];
  if (operation !== ':commit' && operation !== ':batchWrite' && operation !== ':batchGet') return init;
  const body = parseBody(init);
  if (!body) return init;
  if (Array.isArray(body.documents)) body.documents = body.documents.map((name: string) => retargetName(name, target));
  if (Array.isArray(body.writes)) {
    for (const write of body.writes) {
      if (write?.update?.name) write.update.name = retargetName(write.update.name, target);
      if (typeof write?.delete === 'string') write.delete = retargetName(write.delete, target);
      if (write?.transform?.document) write.transform.document = retargetName(write.transform.document, target);
      if (typeof write?.verify === 'string') write.verify = retargetName(write.verify, target);
    }
  }
  return { ...init, body: JSON.stringify(body) };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS = new Set([429, 503]);
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30_000;
// Avoid repeated paid/quota-rejected calls within a warm serverless worker.
// Ordinary transient 429s and 503s still use the existing retry policy.
// Each project has its own daily quota, so each has its own circuit.
const QUOTA_COOLDOWN_MS = 5 * 60_000;
const quotaUnavailableUntil = new Map<string, number>();

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

/** Send a request to an explicitly chosen project, bypassing collection routing (migration tooling). */
export async function firestoreForTarget(target: FirestoreTarget, path: string, init?: RequestInit) {
  const project = projectIdFor(target);
  if (Date.now() < (quotaUnavailableUntil.get(project) ?? 0)) throw new FirestoreError(429, 'daily_quota', target);
  const attempts = retryAttempts();
  const request = retargetBody(path, init, target);
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${baseUrl(target)}${path}`, { ...request, headers: { authorization: `Bearer ${await accessToken(target)}`, 'content-type': 'application/json', ...(request?.headers ?? {}) } });
    if (response.ok) return response.json() as Promise<any>;
    let daily = false;
    if (response.status === 429) {
      // A daily/free-tier quota exhaustion cannot recover after another
      // one-second retry. Keep the generic retry path for burst throttling.
      const payload = await response.clone().json().catch(() => null) as any;
      const message = String(payload?.error?.message ?? payload?.message ?? '');
      daily = /quota exceeded|free.tier|daily (?:quota|limit)|document reads limit/i.test(message);
      console.warn(`Firestore 429 kind=${daily ? 'daily_quota' : 'transient_or_unknown'} target=${target} operation=${request?.method ?? 'GET'} collection=${path.split('?')[0].slice(0, 80)} attempt=${attempt + 1}`);
      if (daily) {
        quotaUnavailableUntil.set(project, Date.now() + QUOTA_COOLDOWN_MS);
        throw new FirestoreError(429, 'daily_quota', target);
      }
    }
    // Throttling and transient unavailability are retried with backoff so bulk
    // onboarding/projection bursts survive quota bursts; local evidence never
    // depends on a single cloud attempt succeeding.
    if (!RETRYABLE_STATUS.has(response.status) || attempt >= attempts) throw new FirestoreError(response.status, undefined, target);
    await sleep(retryDelayMs(attempt, response.headers.get('retry-after')));
  }
}

export async function firestore(path: string, init?: RequestInit) {
  return firestoreForTarget(routeFirestoreRequest(path, init), path, init);
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
  constructor(public readonly status: number, public readonly kind?: 'daily_quota', public readonly target?: FirestoreTarget) { super(`Firestore request failed (${status})`); }
}

/** Full document name in the project that owns the path's collection (runs follow the Keywords project here; commit bodies are retargeted anyway). */
export function firestoreDocumentName(path: string) {
  const target = singleFirestoreProject() ? 'keywords' : collectionOwner(collectionOfPath(path));
  return `${documentsRoot(target)}/${path}`;
}
export function firestoreDocumentNameFor(target: FirestoreTarget, path: string) { return `${documentsRoot(target)}/${path}`; }

/** Whether a target project can be reached (project id resolvable, credentials present). No secrets. */
export function firestoreTargetConfiguration(target: FirestoreTarget) {
  const effective: FirestoreTarget = singleFirestoreProject() ? 'keywords' : target;
  let projectId: string | null = null;
  try { projectId = projectIdFor(effective); } catch { projectId = null; }
  return { projectId, projectConfigured: Boolean(projectId), credentialsConfigured: Boolean(rawServiceAccount(effective)?.trim()) };
}

/** Non-secret routing summary for status endpoints. */
export function firestoreRoutingStatus() {
  const single = singleFirestoreProject();
  return {
    mode: single ? 'single_project' : 'split',
    keywordsProjectId: firestoreTargetConfiguration('keywords').projectId,
    sitesProjectId: firestoreTargetConfiguration('sites').projectId,
    sitesCredentialsConfigured: firestoreTargetConfiguration('sites').credentialsConfigured,
    sitesCollections: [...SITES_FIRESTORE_COLLECTIONS],
    configurationError: single ? null : sitesConfigurationError(),
  };
}
