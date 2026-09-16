import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { field } from '../packages/db/src/firestore.js';
import { researchSessionCreate, researchSessionGet, researchSessionUpdate, serpResearchCached, serpUsageStatus } from '../packages/commands/src/remote-keyword-research.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'test@example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'test' });
process.env.FIREBASE_PROJECT_ID = 'test';
process.env.BRAVE_API_KEY = 'test-brave-key';
process.env.KEYWORDS_SERP_MONTHLY_LIMIT = '4';
process.env.KEYWORDS_SERP_SOFT_LIMIT = '2';
process.env.KEYWORDS_SERP_RESERVE = '2';
process.env.KEYWORDS_SERP_CACHE_TTL_DAYS = '30';

const root = 'projects/test/databases/(default)/documents/';
const docs = new Map<string, any>();
let sequence = 0;
let braveCalls = 0;
let forceUsageRaceToHardLimit = false;
const originalFetch = globalThis.fetch;

function stored(name: string, fields: Record<string, any>) {
  return { name, fields, updateTime: `revision-${++sequence}` };
}
function docPath(url: URL) { return url.pathname.replace('/v1/', ''); }

globalThis.fetch = async (input, init) => {
  const urlString = String(input);
  if (urlString === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
  if (urlString.startsWith('https://api.search.brave.com/')) {
    braveCalls++;
    const query = new URL(urlString).searchParams.get('q') ?? '';
    return Response.json({ web: { results: [
      { title: `${query} 比較`, url: 'https://example.com/compare', description: '2024年版' },
      { title: 'ユーザー体験談', url: 'https://note.com/example', description: '2019年の記事' }
    ] } });
  }
  assert.ok(urlString.startsWith('https://firestore.googleapis.com/'), `Unexpected network: ${urlString}`);
  const url = new URL(urlString);
  const path = docPath(url);
  const body = init?.body ? JSON.parse(String(init.body)) : null;

  if (urlString.endsWith(':commit')) {
    for (const write of body.writes) {
      const previous = docs.get(write.update.name);
      if ((write.currentDocument.exists === false && previous) || (write.currentDocument.updateTime && previous?.updateTime !== write.currentDocument.updateTime)) return Response.json({}, { status: 409 });
    }
    for (const write of body.writes) docs.set(write.update.name, stored(write.update.name, write.update.fields));
    return Response.json({});
  }

  if (init?.method === 'PATCH') {
    const name = path;
    const previous = docs.get(name);
    if (forceUsageRaceToHardLimit && name.includes('/serpUsage/')) {
      forceUsageRaceToHardLimit = false;
      docs.set(name, stored(name, { ...previous.fields, actualApiRequests: field(4), updatedAt: field(new Date().toISOString()) }));
      return Response.json({}, { status: 409 });
    }
    const exists = url.searchParams.get('currentDocument.exists');
    const updateTime = url.searchParams.get('currentDocument.updateTime');
    if ((exists === 'false' && previous) || (updateTime && previous?.updateTime !== updateTime)) return Response.json({}, { status: 409 });
    const next = stored(name, body.fields);
    docs.set(name, next);
    return Response.json(next);
  }

  if (path.endsWith('/researchSessions')) {
    const all = [...docs.values()].filter(doc => doc.name.startsWith(`${root}researchSessions/`)).sort((a, b) => b.fields.updatedAt.stringValue.localeCompare(a.fields.updatedAt.stringValue));
    return Response.json({ documents: all });
  }

  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

try {
  const first = await serpResearchCached({ query: '勤怠管理 SaaS 比較', country: 'JP', language: 'ja' });
  assert.equal(first.cache.hit, false);
  assert.equal(braveCalls, 1);
  assert.equal(first.usage.actualApiRequests, 1);

  const cached = await serpResearchCached({ query: '  勤怠管理   SaaS 比較 ', country: 'jp', language: 'JA' });
  assert.equal(cached.cache.hit, true);
  assert.equal(braveCalls, 1, 'fresh cache must avoid a second SERP API request');
  assert.equal(cached.usage.cacheHits, 1);

  const forced = await serpResearchCached({ query: '勤怠管理 SaaS 比較', country: 'JP', language: 'ja', forceRefresh: true });
  assert.equal(forced.cache.hit, false);
  assert.equal(braveCalls, 2);
  assert.equal(forced.usage.actualApiRequests, 2);
  assert.equal(forced.usage.forcedApiRequests, 1);

  await assert.rejects(serpResearchCached({ query: '経費精算 SaaS 比較', country: 'JP', language: 'ja' }), /soft limit|reserve/i);
  assert.equal(braveCalls, 2, 'soft-limit rejection must happen before provider call');
  const usage = await serpUsageStatus();
  assert.equal(usage.state, 'soft_limited');
  assert.equal(usage.blockedRequests, 1);
  assert.equal(usage.remaining, 2);

  forceUsageRaceToHardLimit = true;
  await assert.rejects(serpResearchCached({ query: '電子契約 比較', country: 'JP', language: 'ja', forceRefresh: true }), /hard limit/i);
  assert.equal(braveCalls, 2, 'a losing quota reservation race must re-read the counter and block before the provider call');
  const hardLimited = await serpUsageStatus();
  assert.equal(hardLimited.actualApiRequests, 4);
  assert.equal(hardLimited.state, 'hard_limited');

  const session = await researchSessionCreate({
    id: 'treasure-2026-09',
    title: 'お宝キーワード探索',
    objective: 'AIで構築可能なDB駆動SEOテーマを探す',
    seedThemes: ['SaaS比較'],
    hypotheses: ['高CPCかつ比較軸が構造化できる領域を優先'],
    nextActions: ['Google Adsで一次審査']
  });
  assert.equal(session.revision, 1);
  assert.ok(session.runId);

  const keywordId = 'a'.repeat(32);
  const updated = await researchSessionUpdate({
    id: session.id,
    expectedRevision: 1,
    addResearchedKeywordIds: [keywordId],
    addShortlistedKeywordIds: [keywordId],
    addFindings: ['勤怠管理SaaSは比較属性が豊富'],
    addNextActions: ['有望KWだけSERP二次審査']
  });
  assert.equal(updated.revision, 2);
  assert.deepEqual(updated.shortlistedKeywordIds, [keywordId]);
  await assert.rejects(researchSessionUpdate({ id: session.id, expectedRevision: 1, notes: 'stale write' }), /Revision conflict/);
  const resumed = await researchSessionGet({});
  assert.equal(resumed.id, session.id);
  assert.equal(resumed.revision, 2);
  assert.equal(resumed.findings[0], '勤怠管理SaaSは比較属性が豊富');

  console.log('remote keyword workflow smoke passed: cache reuse, quota reserve/race protection, forced refresh, audited resumable research sessions');
} finally {
  globalThis.fetch = originalFetch;
}
