import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const dbPath = process.env.KEYWORDS_DB_PATH ?? '/tmp/keywords-review-smoke.sqlite';
rmSync(dbPath, { force: true });

const { commands } = await import('@keywords/commands');
const { planningCommands } = await import('@keywords/commands/planning');
const { workCommands } = await import('@keywords/commands/work');
const { reviewCommands } = await import('@keywords/commands/review');
const agent = { actor: 'agent' as const, actorId: 'ci-review-agent' };
const human = { actor: 'human' as const, actorId: 'ci-review-human' };

const project = await commands.project.create(agent, { name: 'Review Smoke' });
const keyword = await commands.keyword.create(agent, { projectId: project.id, text: 'agent review workflow', avgMonthly: 300 });
const cluster = await commands.cluster.create(agent, { projectId: project.id, title: 'Agent review workflow', intent: 'informational' });
await planningCommands.clusterBulkAssign(agent, { projectId: project.id, clusterId: cluster.id, keywordIds: [keyword.id] });

const session = await workCommands.start(agent, {
  projectId: project.id,
  objective: 'Create one page plan and obtain a human decision.',
  completionCriteria: ['Page plan is reviewed by a human.'],
  maxActions: 8
});
const scopedAgent = { ...agent, projectId: project.id, workSessionId: session.id };
const plan = await planningCommands.pagePlan(scopedAgent, {
  projectId: project.id,
  title: 'Agent Review Workflow Guide',
  clusterId: cluster.id,
  primaryKeywordId: keyword.id,
  rationale: 'One validated informational intent.'
});

const request = await reviewCommands.request(scopedAgent, {
  projectId: project.id,
  sessionId: session.id,
  targetType: 'page',
  targetId: plan.page.id,
  title: 'Approve the Agent Review Workflow page plan',
  question: 'Should this proposal become an approved workspace page?'
});
assert.equal(request.status, 'open');
assert.deepEqual(request.options, ['approved', 'needs_edit', 'rejected']);

let context = await workCommands.context(agent, { projectId: project.id, sessionId: session.id });
assert.equal(context.session?.status, 'awaiting_review');

await assert.rejects(
  reviewCommands.resolve(scopedAgent, { projectId: project.id, reviewId: request.id, resolution: 'approved' }),
  /human actor/
);

const resolved = await reviewCommands.resolve(human, { projectId: project.id, reviewId: request.id, resolution: 'approved' });
assert.equal(resolved.review?.status, 'resolved');
assert.equal(resolved.review?.resolution, 'approved');

const page = await planningCommands.pageTargets(human, { projectId: project.id, pageId: plan.page.id });
assert.equal(page.page.status, 'approved');
const open = await reviewCommands.list(human, { projectId: project.id, status: 'open' });
assert.equal(open.length, 0);

context = await workCommands.context(agent, { projectId: project.id, sessionId: session.id });
assert.equal(context.session?.status, 'running');
assert.match(context.session?.checkpoints[0]?.summary ?? '', /Human review resolved/);

const completed = await workCommands.complete(scopedAgent, { projectId: project.id, sessionId: session.id, summary: 'Human approved the page plan.' });
assert.equal(completed.status, 'completed');
assert.equal(completed.current.approvedPages, 1);

console.log(JSON.stringify({ ok: true, projectId: project.id, reviewId: request.id, pageId: plan.page.id, sessionId: session.id }));
