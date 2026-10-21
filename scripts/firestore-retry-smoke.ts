import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { firestore, FirestoreError } from '../packages/db/src/firestore.js';
import { paceCloudWrite } from '../packages/commands/src/remote-site-operations.js';

// Deterministic Firestore retry double. Never loads .env or touches production data.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'test@example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'test' });
process.env.FIREBASE_PROJECT_ID = 'test';
delete process.env.KEYWORDS_FIRESTORE_RETRY_ATTEMPTS;
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
let calls: string[] = [];
let script: Array<{ status: number; body?: unknown; retryAfter?: string }> = [];

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
  assert.ok(url.startsWith('https://firestore.googleapis.com/'), `Unexpected network: ${url}`);
  calls.push(url);
  const step = script.shift() ?? { status: 200, body: {} };
  const headers = step.retryAfter !== undefined ? { 'retry-after': step.retryAfter } : undefined;
  return Response.json(step.body ?? {}, { status: step.status, headers });
};

try {
  // 429 with Retry-After: 0, then 503, then success: three attempts, one result.
  script = [
    { status: 429, retryAfter: '0' },
    { status: 503 },
    { status: 200, body: { ok: true } },
  ];
  calls = [];
  assert.deepEqual(await firestore('/sites?pageSize=1'), { ok: true });
  assert.equal(calls.length, 3);

  // Non-retryable status fails immediately without another attempt.
  script = [{ status: 400, body: {} }, { status: 200, body: {} }];
  calls = [];
  await assert.rejects(firestore('/sites?pageSize=1'), (error: unknown) => error instanceof FirestoreError && error.status === 400);
  assert.equal(calls.length, 1);

  // Retry budget exhausted: three retries (four attempts) then the last 429 surfaces.
  script = [{ status: 429 }, { status: 429 }, { status: 429 }, { status: 429 }, { status: 200, body: {} }];
  calls = [];
  await assert.rejects(firestore('/sites?pageSize=1'), (error: unknown) => error instanceof FirestoreError && error.status === 429);
  assert.equal(calls.length, 4);

  // Retries can be disabled entirely through the environment.
  process.env.KEYWORDS_FIRESTORE_RETRY_ATTEMPTS = '0';
  script = [{ status: 429 }, { status: 200, body: {} }];
  calls = [];
  await assert.rejects(firestore('/sites?pageSize=1'), (error: unknown) => error instanceof FirestoreError && error.status === 429);
  assert.equal(calls.length, 1);
  delete process.env.KEYWORDS_FIRESTORE_RETRY_ATTEMPTS;

  // Bulk control-plane writes can be paced to stay under Firestore throttling.
  process.env.KEYWORDS_FIRESTORE_WRITE_DELAY_MS = '0';
  const fastStart = Date.now();
  await paceCloudWrite();
  assert.ok(Date.now() - fastStart < 1000, 'zero delay must not wait');
  delete process.env.KEYWORDS_FIRESTORE_WRITE_DELAY_MS;
  const slowStart = Date.now();
  await paceCloudWrite();
  const elapsed = Date.now() - slowStart;
  assert.ok(elapsed >= 300 && elapsed < 5000, `default delay should wait ~400ms (waited ${elapsed}ms)`);

  // Daily quota exhaustion is terminal for this invocation and short-circuits
  // further calls in the same warm worker; generic 429 retry remains tested above.
  script = [{ status: 429, body: {error: {status:'RESOURCE_EXHAUSTED',message:'Quota exceeded for daily free-tier reads'}}}, {status:200,body:{ok:true}}];
  calls = [];
  await assert.rejects(firestore('/sites?pageSize=1'), (error: unknown) => error instanceof FirestoreError && error.status === 429);
  assert.equal(calls.length, 1, 'known daily quota exhaustion must not retry');
  await assert.rejects(firestore('/sites?pageSize=1'), (error: unknown) => error instanceof FirestoreError && error.status === 429);
  assert.equal(calls.length, 1, 'quota cooldown must reject before issuing another request');
  const quotaAt = Date.now();
  Date.now = () => quotaAt + 31_000;
  await assert.rejects(firestore('/sites?pageSize=1'), (error: unknown) => error instanceof FirestoreError && error.status === 429);
  assert.equal(calls.length, 1, 'daily quota must not be probed again after only 30 seconds');
  Date.now = () => quotaAt + 301_000;
  assert.deepEqual(await firestore('/sites?pageSize=1'), { ok: true }, 'a later request can recover after cooldown');

  console.log('firestore retry smoke passed: transient retries, daily quota fail-fast/circuit, and bulk write pacing');
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
}
