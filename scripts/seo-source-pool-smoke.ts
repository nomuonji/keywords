import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { field, value } from '../packages/db/src/firestore.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'test@example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'test' });
process.env.FIREBASE_PROJECT_ID = 'test';

const root = 'projects/test/databases/(default)/documents/';
const docs = new Map<string, any>();
let seq = 0;
const originalFetch = globalThis.fetch;
const decode = (v: any): any => value(v);

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-token', expires_in: 3600 });
  assert.ok(url.startsWith('https://firestore.googleapis.com/'), `Unexpected network: ${url}`);
  const parsed = new URL(url);
  const path = parsed.pathname.replace('/v1/', '');
  const body = init?.body ? JSON.parse(String(init.body)) : null;

  if (url.endsWith(':commit')) {
    for (const write of body.writes) {
      const prev = docs.get(write.update.name);
      if (write.currentDocument?.exists === false && prev) return Response.json({}, { status: 409 });
      if (write.currentDocument?.updateTime && prev?.updateTime !== write.currentDocument.updateTime) return Response.json({}, { status: 409 });
    }
    for (const write of body.writes) docs.set(write.update.name, { ...write.update, updateTime: `rev-${++seq}` });
    return Response.json({});
  }

  if (/\/(seoSourceAccounts|seoSourceScans)$/.test(path)) {
    const collection = path.split('/').at(-1)!;
    const rows = [...docs.values()].filter(doc => doc.name.startsWith(`${root}${collection}/`));
    return Response.json({ documents: rows.slice(0, Number(parsed.searchParams.get('pageSize') ?? 500)) });
  }

  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

try {
  const {
    seoSourceGet,
    seoSourcePoolContext,
    seoSourceSave,
    seoSourceScanRecord
  } = await import('../packages/commands/src/seo-source-pool.js');

  const initial = await seoSourcePoolContext({});
  assert.ok(initial.items.some((item: any) => item.id === 'x_ezayan' && item.origin === 'builtin'));
  assert.ok(initial.dueSourceIds.includes('x_ezayan'));

  const materialized = await seoSourceSave({
    id: 'x_ezayan',
    expectedRevision: 0,
    reviewCadenceDays: 5,
    notes: 'Materialized in Firestore from builtin seed.'
  });
  assert.equal(materialized.source.revision, 1);
  assert.equal(materialized.source.origin, 'firestore');
  assert.equal(materialized.source.reviewCadenceDays, 5);

  const scan = await seoSourceScanRecord({
    sourceId: 'x_ezayan',
    reviewedAt: '2026-10-01T09:00:00+09:00',
    periodStart: '2026-09-24',
    periodEnd: '2026-10-01',
    outcome: 'useful',
    summary: 'Recent posts contained concrete DB-site structure and crawl/indexing observations.',
    limitations: ['Public mirrors may omit some X posts.'],
    findings: [{
      url: 'https://x.com/ezayan/status/123',
      publishedAt: '2026-09-27T12:00:00+09:00',
      claimSummary: 'Deep hierarchy can expose crawl/indexing weaknesses in large database-driven sites.',
      relevance: 'Potentially useful for Sites Operator technical planning and structure diagnostics.',
      disposition: 'candidate',
      confidence: 'medium',
      verificationNeeded: true,
      evaluatorIds: ['site_structure_health'],
      notes: 'Practitioner observation; verify against site-specific evidence and primary Search guidance.'
    }],
    actor: 'seo-source-pool-smoke'
  });
  assert.equal(scan.scan.outcome, 'useful');
  assert.equal(scan.scan.findings.length, 1);

  const detail = await seoSourceGet({ id: 'x_ezayan', scanLimit: 5 });
  assert.equal(detail.source.origin, 'firestore');
  assert.equal(detail.scans.length, 1);
  assert.equal(detail.scans[0].findings[0].disposition, 'candidate');

  const context = await seoSourcePoolContext({ staleAfterDays: 14 });
  const ezayan = context.items.find((item: any) => item.id === 'x_ezayan');
  assert.ok(ezayan);
  assert.equal(ezayan.latestScan.outcome, 'useful');
  assert.equal(context.recentUsefulFindings.length, 1);
  assert.match(context.rules.join(' '), /Source reputation is not evidence/);

  await assert.rejects(seoSourceSave({
    id: 'x_ezayan',
    expectedRevision: 0,
    notes: 'stale write'
  }), /Revision conflict/);

  console.log('seo source pool smoke passed: builtin seed, Firestore override, scans, findings, due-review context');
} finally {
  globalThis.fetch = originalFetch;
}
