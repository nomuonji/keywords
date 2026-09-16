import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { rmSync } from 'node:fs';

const dbPath = `/tmp/keywords-site-optimization-${process.pid}.sqlite`;
for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  try { rmSync(path, { force: true }); } catch {}
}
process.env.KEYWORDS_DB_PATH = dbPath;
process.env.KEYWORDS_SITE_OPTIMIZATION_MAX_SNAPSHOT_AGE_HOURS = '72';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: 'test@example.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: 'test'
});
process.env.FIREBASE_PROJECT_ID = 'test';

const root = 'projects/test/databases/(default)/documents/';
const docs = new Map<string, any>();
let sequence = 0;
const originalFetch = globalThis.fetch;
const decodeField = (value: any): any => value?.stringValue ?? value?.integerValue ?? value?.doubleValue ?? value?.booleanValue ?? null;

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
  assert.ok(url.startsWith('https://firestore.googleapis.com/'), `Unexpected network: ${url}`);
  const parsed = new URL(url);
  const path = parsed.pathname.replace('/v1/', '');
  const body = init?.body ? JSON.parse(String(init.body)) : null;

  if (url.endsWith(':commit')) {
    for (const write of body.writes) {
      const previous = docs.get(write.update.name);
      if (write.currentDocument?.exists === false && previous) return Response.json({}, { status: 409 });
      if (write.currentDocument?.updateTime && previous?.updateTime !== write.currentDocument.updateTime) return Response.json({}, { status: 409 });
    }
    for (const write of body.writes) docs.set(write.update.name, { ...write.update, updateTime: `revision-${++sequence}` });
    return Response.json({});
  }

  if (url.endsWith(':runQuery')) {
    const query = body.structuredQuery;
    const collection = query.from[0].collectionId;
    const filter = query.where.fieldFilter;
    const expected = decodeField(filter.value);
    const result = [...docs.values()]
      .filter(doc => doc.name.startsWith(`${root}${collection}/`) && decodeField(doc.fields?.[filter.field.fieldPath]) === expected)
      .slice(0, Number(query.limit ?? 500))
      .map(document => ({ document }));
    return Response.json(result);
  }

  if (/\/(sites|articles|metricSnapshots|optimizationEvents)$/.test(path)) {
    const collection = path.split('/').at(-1)!;
    const all = [...docs.values()].filter(doc => doc.name.startsWith(`${root}${collection}/`));
    return Response.json({ documents: all.slice(0, Number(parsed.searchParams.get('pageSize') ?? 50)) });
  }

  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

const day = 86_400_000;
const date = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

try {
  const { getDatabase } = await import('../packages/db/src/index.js');
  const { operationCommands } = await import('../packages/commands/src/operation.js');
  const {
    metricSnapshotSave,
    siteArticleSave,
    siteRegistrySave
  } = await import('../packages/commands/src/remote-site-operations.js');
  const {
    localSiteOptimizationCandidate,
    localSiteOptimizationContext,
    localSiteOptimizationCreate,
    localSiteOptimizationMarkImplemented
  } = await import('../packages/commands/src/site-optimization-workflow.js');
  const { sqlite } = getDatabase();
  const t = new Date().toISOString();

  sqlite.prepare(`INSERT INTO projects(id,name,domain,mode,environment,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
    .run('project-a', 'Project A', 'example.com', 'existing_site', 'production', t, t);
  const operation = await operationCommands.start({ actor: 'human', actorId: 'fixture' }, {
    requestText: 'Investigate the measured decline and make at most one evidence-backed existing-page change.',
    requestKey: `fixture-${process.pid}`,
    projectIds: ['project-a'],
    constraints: { operatorKind: 'investigate_query_drop' },
    budget: { maxActions: 10, maxExternalRequests: 2, maxCandidateWrites: 2 }
  });
  assert.equal(operation.reused, false);

  await siteRegistrySave({
    id: 'site-a', expectedRevision: 0, localProjectId: 'project-a', name: 'Site A', repository: 'nomuonji/site-a',
    productionUrl: 'https://example.com', deploymentProvider: 'vercel', searchConsoleProperty: 'sc-domain:example.com', status: 'active'
  });
  await siteArticleSave({
    id: 'article-a', expectedRevision: 0, siteId: 'site-a', localPageId: 'page-a', canonicalUrl: 'https://example.com/article-a',
    repo: 'nomuonji/site-a', repoPath: 'content/article-a.mdx', currentCommitSha: 'a'.repeat(40), slug: 'article-a', title: 'Article A', status: 'published'
  });

  const previous = await metricSnapshotSave({
    siteId: 'site-a', articleId: 'article-a', provider: 'gsc', periodStart: date(-15), periodEnd: date(-9),
    metrics: { clicks: 20, impressions: 300, ctr: 20 / 300, averagePosition: 9 },
    sourceVersion: 'proposal-previous', capturedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString()
  });
  const latest = await metricSnapshotSave({
    siteId: 'site-a', articleId: 'article-a', provider: 'gsc', periodStart: date(-8), periodEnd: date(-2),
    metrics: { clicks: 5, impressions: 320, ctr: 5 / 320, averagePosition: 14 },
    sourceVersion: 'proposal-latest', capturedAt: new Date().toISOString()
  });

  const candidate = await localSiteOptimizationCandidate({ projectId: 'project-a' });
  assert.equal(candidate.status, 'ready');
  if (candidate.status !== 'ready') throw new Error('expected ready candidate');
  assert.equal(candidate.candidate.articleId, 'article-a');
  assert.equal(candidate.candidate.baselineSnapshotId, latest.id);
  assert.equal(candidate.candidate.comparisonSnapshotId, previous.id);
  assert.ok(candidate.candidate.signals.includes('click_decline'));
  assert.ok(candidate.candidate.signals.includes('position_decline'));
  assert.ok(candidate.candidate.signals.includes('ctr_decline'));

  const created = await localSiteOptimizationCreate({
    projectId: 'project-a', eventId: candidate.candidate.eventId, articleId: 'article-a',
    baselineSnapshotId: latest.id, comparisonSnapshotId: previous.id,
    observation: 'Fresh complete article-level GSC shows materially lower clicks, CTR and ranking than the prior equal-length period.',
    diagnosis: 'The mapped article may no longer answer the dominant reader task as directly as competing results.',
    hypothesis: 'One focused revision that restores direct task coverage should improve clicks and ranking without changing the URL or intent.',
    actionType: 'content_expand', notes: 'Fixture proposal before any article edit.'
  });
  assert.equal(created.phase, 'proposed');
  assert.equal(created.result, 'pending');
  assert.equal(created.revision, 1);
  assert.equal(created.baselineSnapshotId, latest.id);

  const context = await localSiteOptimizationContext({ projectId: 'project-a', articleId: 'article-a' });
  assert.equal(context.changeAllowed, false);
  assert.equal(context.pendingProposed?.id, candidate.candidate.eventId);

  const reused = await localSiteOptimizationCreate({
    projectId: 'project-a', eventId: candidate.candidate.eventId, articleId: 'article-a',
    baselineSnapshotId: latest.id, comparisonSnapshotId: previous.id,
    observation: 'Fresh complete article-level GSC shows materially lower clicks, CTR and ranking than the prior equal-length period.',
    diagnosis: 'The mapped article may no longer answer the dominant reader task as directly as competing results.',
    hypothesis: 'One focused revision that restores direct task coverage should improve clicks and ranking without changing the URL or intent.',
    actionType: 'content_expand', notes: 'Fixture proposal before any article edit.'
  });
  assert.equal(reused.reused, true);

  const blocked = await localSiteOptimizationCandidate({ projectId: 'project-a' });
  assert.equal(blocked.status, 'blocked_by_active_optimization');

  const implemented = await localSiteOptimizationMarkImplemented({
    projectId: 'project-a', eventId: candidate.candidate.eventId, expectedRevision: 1,
    afterCommit: 'b'.repeat(40), changedAt: new Date().toISOString(), notes: 'Fixture represents a verified pushed commit and live delivery.'
  });
  assert.equal(implemented.phase, 'implemented');
  assert.equal(implemented.result, 'pending');
  assert.equal(implemented.afterCommit, 'b'.repeat(40));
  assert.ok(implemented.evaluateAfter);

  const implementedAgain = await localSiteOptimizationMarkImplemented({
    projectId: 'project-a', eventId: candidate.candidate.eventId, expectedRevision: implemented.revision,
    afterCommit: 'b'.repeat(40), notes: 'Idempotent resume.'
  });
  assert.equal(implementedAgain.reused, true);

  const runCommands = sqlite.prepare('SELECT command FROM runs WHERE work_session_id=? ORDER BY created_at').all(operation.children[0].workSessionId) as Array<{ command: string }>;
  assert.ok(runCommands.some(row => row.command === 'site_optimization.create'));
  assert.ok(runCommands.some(row => row.command === 'site_optimization.mark_implemented'));

  console.log('site optimization workflow smoke passed: fresh decline -> pinned proposed event -> no overlap -> implemented commit -> pending traffic-aware evaluation');
} finally {
  globalThis.fetch = originalFetch;
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(path, { force: true }); } catch {}
  }
}
