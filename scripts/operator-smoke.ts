import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dbPath = join(mkdtempSync(join(tmpdir(), 'keywords-operator-')), 'test.sqlite');
process.env.KEYWORDS_DB_PATH = dbPath;

const { getDatabase, schema } = await import('@keywords/db');
const { operatorCommands } = await import('@keywords/commands/operator');
const { db, sqlite } = getDatabase();
const t = new Date().toISOString();
const oldObservedAt = '2026-08-08T00:00:00.000Z';
const newObservedAt = '2026-08-15T00:00:00.000Z';
const projectId = 'project-operator-smoke';
const keywordId = 'keyword-operator-smoke';
await db.insert(schema.projects).values({ id: projectId, name: 'Operator smoke', domain: 'example.com', createdAt: t, updatedAt: t });
await db.insert(schema.keywords).values({ id: keywordId, projectId, topicId: null, text: 'agent seo', normalized: 'agent seo', source: 'test', status: 'active', avgMonthly: 500, competition: 0.2, cpcMicros: null, gscClicks: 4, gscImpressions: 90, gscCtr: 0.04, gscPosition: 14, gscUpdatedAt: t, createdAt: t, updatedAt: t });
const scope = {
  provider: 'gsc',
  property: 'https://example.com/',
  targetOrigin: 'https://example.com',
  filters: [{ groupType: 'and', filters: [{ dimension: 'page', operator: 'includingRegex', expression: '^https://example\\.com(?:/|$)' }] }],
  timezone: 'UTC',
  searchType: 'web',
  dimensions: ['query', 'page']
};
for (const observation of [
  { id: 'measurement-old', startDate: '2026-08-01', endDate: '2026-08-07', capturedAt: oldObservedAt, version: 'operator-old' },
  { id: 'measurement-new', startDate: '2026-08-08', endDate: '2026-08-14', capturedAt: newObservedAt, version: 'operator-new' }
]) {
  sqlite.prepare(`INSERT INTO measurement_imports(id,project_id,provider,property,target_origin,filters_json,start_date,end_date,timezone,search_type,dimensions_json,status,completeness,source_label,source_version,captured_at,payload_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    observation.id, projectId, scope.provider, scope.property, scope.targetOrigin, JSON.stringify(scope.filters), observation.startDate, observation.endDate,
    scope.timezone, scope.searchType, JSON.stringify(scope.dimensions), 'succeeded', 'complete', `Operator ${observation.version}`, observation.version,
    observation.capturedAt, JSON.stringify({ fixture: true }), observation.capturedAt
  );
}
await db.insert(schema.keywordMetricSnapshots).values([
  { id: 'snapshot-old', projectId, keywordId, query: 'agent seo', siteUrl: scope.property, startDate: '2026-08-01', endDate: '2026-08-07', searchType: 'web', clicks: 20, impressions: 120, ctr: 0.166, position: 7, observedAt: oldObservedAt },
  { id: 'snapshot-new', projectId, keywordId, query: 'agent seo', siteUrl: scope.property, startDate: '2026-08-08', endDate: '2026-08-14', searchType: 'web', clicks: 4, impressions: 90, ctr: 0.044, position: 14, observedAt: newObservedAt }
]);
const ctx = { actor: 'system' as const, actorId: 'smoke' };
const inspected = await operatorCommands.inspect(ctx, projectId);
assert.equal((inspected.next as any).kind, 'investigate_query_drop');
const first = await operatorCommands.tick(ctx, projectId);
assert.ok(first.createdTask);
assert.equal(first.createdTask.relatedType, 'keyword');
assert.equal(first.createdTask.relatedId, keywordId);
const second = await operatorCommands.tick(ctx, projectId);
assert.equal(second.createdTask, null);
assert.equal((second.next as any).kind, 'existing_task');

// Metric scheduling must follow the shared multi-site property resolver rather
// than requiring one process-global GOOGLE_SEARCH_CONSOLE_SITE_URL.
process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN = 'fixture-gsc-token';
delete process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL;
const multiSiteProjectId = 'project-operator-multisite-gsc';
await db.insert(schema.projects).values({
  id: multiSiteProjectId, name: 'Operator multisite GSC', domain: 'multisite.example.com', mode: 'existing_site', createdAt: t, updatedAt: t
});
const multiSite = await operatorCommands.inspect(ctx, multiSiteProjectId);
assert.ok((multiSite.candidates as any[]).some(candidate => candidate.kind === 'capture_metrics'), 'origin + GSC credentials should schedule metric capture without a global property env');

const boundProjectId = 'project-operator-binding-gsc';
await db.insert(schema.projects).values({
  id: boundProjectId, name: 'Operator binding GSC', domain: null, mode: 'existing_site', createdAt: t, updatedAt: t
});
sqlite.prepare(`INSERT INTO blog_bindings(project_id,blog_site_id,origin,language,country,snapshot_json,snapshot_hash,observed_at)
  VALUES(?,?,?,?,?,?,?,?)`).run(boundProjectId, 'bound-site', 'https://bound.example.com', 'en', 'US', '{}', 'binding-fixture', t);
const bound = await operatorCommands.inspect(ctx, boundProjectId);
assert.ok((bound.candidates as any[]).some(candidate => candidate.kind === 'capture_metrics'), 'confirmed Blog origin + GSC credentials should schedule metric capture without a project domain');

const noScopeProjectId = 'project-operator-no-gsc-scope';
await db.insert(schema.projects).values({
  id: noScopeProjectId, name: 'Operator no GSC scope', domain: null, mode: 'existing_site', createdAt: t, updatedAt: t
});
const noScope = await operatorCommands.inspect(ctx, noScopeProjectId);
assert.ok(!(noScope.candidates as any[]).some(candidate => candidate.kind === 'capture_metrics'), 'credentials alone must not schedule metric capture without a project origin or configured property');

sqlite.close();
console.log(JSON.stringify({
  ok: true,
  next: 'investigate_query_drop',
  taskId: first.createdTask.id,
  multiSiteMetricsScheduled: true,
  bindingOriginMetricsScheduled: true,
  noScopeMetricsBlocked: true
}));
