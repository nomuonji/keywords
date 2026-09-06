import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const dbPath = process.env.KEYWORDS_DB_PATH ?? '/tmp/keywords-planning-smoke.sqlite';
rmSync(dbPath, { force: true });

const { commands } = await import('@keywords/commands');
const { planningCommands } = await import('@keywords/commands/planning');
const ctx = { actor: 'agent' as const, actorId: 'ci-smoke' };

const project = await commands.project.create(ctx, { name: 'Planning Smoke' });
const first = await commands.keyword.create(ctx, { projectId: project.id, text: 'seo agent workspace', avgMonthly: 1000, competition: 0.2 });
const second = await commands.keyword.create(ctx, { projectId: project.id, text: 'ai seo workspace', avgMonthly: 500, competition: 0.3 });
const cluster = await commands.cluster.create(ctx, { projectId: project.id, title: 'Agent SEO workspace', intent: 'informational' });

const assigned = await planningCommands.clusterBulkAssign(ctx, { projectId: project.id, clusterId: cluster.id, keywordIds: [first.id, second.id] });
assert.equal(assigned.assigned, 2);

const firstPlan = await planningCommands.pagePlan(ctx, {
  projectId: project.id,
  title: 'SEO Agent Workspace Guide',
  clusterId: cluster.id,
  rationale: 'Validated shared intent for the target queries.',
  primaryKeywordId: first.id,
  secondaryKeywordIds: [second.id]
});
assert.equal(firstPlan.targets.length, 2);
assert.equal(firstPlan.warnings.length, 0);

const secondPlan = await planningCommands.pagePlan(ctx, {
  projectId: project.id,
  title: 'Another SEO Agent Workspace Guide',
  clusterId: cluster.id,
  rationale: 'Intentional overlap used to verify conflict detection.',
  primaryKeywordId: first.id
});
assert.ok(secondPlan.warnings.some(warning => warning.type === 'keyword_target_overlap'));
assert.ok(secondPlan.warnings.some(warning => warning.type === 'same_cluster_page'));

const conflicts = await planningCommands.pageCannibalization(ctx, { projectId: project.id });
assert.equal(conflicts.exactTargetConflicts.length, 1);
assert.equal(conflicts.sameClusterConflicts.length, 1);
assert.equal(conflicts.checkedPages, 2);

console.log(JSON.stringify({ ok: true, projectId: project.id, exactConflicts: conflicts.exactTargetConflicts.length, clusterConflicts: conflicts.sameClusterConflicts.length }));
