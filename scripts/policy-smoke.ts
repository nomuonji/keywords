import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const dbPath = process.env.KEYWORDS_DB_PATH ?? '/tmp/keywords-policy-smoke.sqlite';
rmSync(dbPath, { force: true });

const { commands } = await import('@keywords/commands');
const { policyCommands } = await import('@keywords/commands/policy');
const agent = { actor: 'agent' as const, actorId: 'ci-policy-agent' };
const human = { actor: 'human' as const, actorId: 'ci-policy-human' };

const project = await commands.project.create(agent, { name: 'Policy Smoke' });
const first = await commands.decision.record(human, {
  projectId: project.id,
  action: 'page.review',
  targetType: 'page',
  targetId: 'page-a',
  verdict: 'rejected',
  reason: 'Generic top-list intent is too competitive and does not use our structured data advantage.'
});
const second = await commands.decision.record(human, {
  projectId: project.id,
  action: 'page.review',
  targetType: 'page',
  targetId: 'page-b',
  verdict: 'rejected',
  reason: 'Avoid generic ranking pages when the project cannot differentiate with structured data.'
});

let context = await policyCommands.context(agent, project.id);
assert.equal(context.decisionPatterns.length, 1);
assert.equal(context.decisionPatterns[0]?.count, 2);
assert.deepEqual(context.decisionPatterns[0]?.decisionIds.sort(), [first.id, second.id].sort());

const candidate = await policyCommands.propose(agent, {
  projectId: project.id,
  scope: 'page_strategy',
  rule: 'Avoid generic ranking/list pages unless structured project data creates a clear differentiation advantage.',
  rationale: 'Repeated human rejection of undifferentiated list-page proposals.',
  sourceDecisionIds: [first.id, second.id]
});
assert.equal(candidate.status, 'candidate');
assert.deepEqual(candidate.sourceDecisionIds.sort(), [first.id, second.id].sort());

await assert.rejects(
  policyCommands.review(agent, { projectId: project.id, policyId: candidate.id, verdict: 'active' }),
  /human actor/
);

const activated = await policyCommands.review(human, { projectId: project.id, policyId: candidate.id, verdict: 'active' });
assert.equal(activated.status, 'active');
context = await policyCommands.context(agent, project.id);
assert.equal(context.active.length, 1);
assert.equal(context.active[0]?.id, candidate.id);
assert.equal(context.candidates.length, 0);

const retired = await policyCommands.retire(human, { projectId: project.id, policyId: candidate.id, reason: 'Project strategy changed after a new structured comparison dataset was added.' });
assert.equal(retired.status, 'retired');
context = await policyCommands.context(agent, project.id);
assert.equal(context.active.length, 0);
assert.equal(context.retired[0]?.id, candidate.id);

console.log(JSON.stringify({ ok: true, projectId: project.id, policyId: candidate.id, sourceDecisions: candidate.sourceDecisionIds.length, repeatedPatterns: context.decisionPatterns.length }));
