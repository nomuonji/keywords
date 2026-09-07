import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const dbPath = process.env.KEYWORDS_DB_PATH ?? '/tmp/keywords-operator-smoke.sqlite';
rmSync(dbPath, { force: true });

const { getDatabase, schema } = await import('@keywords/db');
const { operatorCommands } = await import('@keywords/commands/operator');
const { db, sqlite } = getDatabase();
const t = new Date().toISOString();
const projectId = 'project-operator-smoke';
const keywordId = 'keyword-operator-smoke';
await db.insert(schema.projects).values({ id: projectId, name: 'Operator smoke', domain: 'example.com', createdAt: t, updatedAt: t });
await db.insert(schema.keywords).values({ id: keywordId, projectId, topicId: null, text: 'agent seo', normalized: 'agent seo', source: 'test', status: 'active', avgMonthly: 500, competition: 0.2, cpcMicros: null, gscClicks: 4, gscImpressions: 90, gscCtr: 0.04, gscPosition: 14, gscUpdatedAt: t, createdAt: t, updatedAt: t });
await db.insert(schema.keywordMetricSnapshots).values([
  { id: 'snapshot-old', projectId, keywordId, query: 'agent seo', siteUrl: 'https://example.com/', startDate: '2026-08-01', endDate: '2026-08-07', searchType: 'web', clicks: 20, impressions: 120, ctr: 0.166, position: 7, observedAt: t },
  { id: 'snapshot-new', projectId, keywordId, query: 'agent seo', siteUrl: 'https://example.com/', startDate: '2026-08-08', endDate: '2026-08-14', searchType: 'web', clicks: 4, impressions: 90, ctr: 0.044, position: 14, observedAt: t }
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
sqlite.close();
console.log(JSON.stringify({ ok: true, next: 'investigate_query_drop', taskId: first.createdTask.id }));
