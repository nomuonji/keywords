import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const dbPath = process.env.KEYWORDS_DB_PATH ?? '/tmp/keywords-work-loop-smoke.sqlite';
rmSync(dbPath, { force: true });

const { commands } = await import('@keywords/commands');
const { workCommands } = await import('@keywords/commands/work');
const agent = { actor: 'agent' as const, actorId: 'ci-work-agent' };
const human = { actor: 'human' as const, actorId: 'ci-work-human' };

const project = await commands.project.create(agent, { name: 'Work Loop Smoke' });
const task = await commands.task.create(human, {
  projectId: project.id,
  title: 'Validate one keyword opportunity',
  priority: 90,
  assigneeType: 'agent'
});

const session = await workCommands.start(agent, { projectId: project.id, maxActions: 5 });
assert.equal(session.status, 'running');
assert.equal(session.remainingActions, 5);
assert.match(session.objective, /Validate one keyword opportunity/);
assert.ok(session.completionCriteria.length >= 1);

const scopedAgent = { ...agent, projectId: project.id, workSessionId: session.id };
await commands.task.setStatus(scopedAgent, { projectId: project.id, taskId: task.id, status: 'doing' });
await commands.keyword.create(scopedAgent, { projectId: project.id, text: 'agent seo work loop', avgMonthly: 240 });
await commands.task.setStatus(scopedAgent, { projectId: project.id, taskId: task.id, status: 'review' });

const paused = await workCommands.checkpoint(scopedAgent, {
  projectId: project.id,
  sessionId: session.id,
  state: 'awaiting_review',
  summary: 'Keyword opportunity was captured and the assigned task is ready for review.',
  nextAction: 'Resume after review, then close the task if accepted.'
});
assert.equal(paused.status, 'awaiting_review');
assert.equal(paused.usage.actions, 3);
assert.equal(paused.remainingActions, 2);

const context = await workCommands.context(agent, { projectId: project.id, sessionId: session.id });
assert.equal(context.session?.id, session.id);
assert.equal(context.next.kind, 'await_human_review');

const resumed = await workCommands.resume(agent, { projectId: project.id, sessionId: session.id });
assert.equal(resumed.status, 'running');
await commands.task.setStatus(scopedAgent, { projectId: project.id, taskId: task.id, status: 'done' });

const completed = await workCommands.complete(scopedAgent, {
  projectId: project.id,
  sessionId: session.id,
  summary: 'Validated the opportunity, persisted the keyword, and completed the assigned task.'
});
assert.equal(completed.status, 'completed');
assert.equal(completed.usage.actions, 4);
assert.equal(completed.diff.keywords, 1);
assert.equal(completed.diff.openTasks, -1);
assert.equal(completed.current.openTasks, 0);

await assert.rejects(
  workCommands.resume(agent, { projectId: project.id, sessionId: session.id }),
  /Cannot resume completed/
);

const second = await workCommands.start(agent, {
  projectId: project.id,
  objective: 'Confirm a new work session can start after completion.',
  completionCriteria: ['Leave a terminal session state.'],
  maxActions: 2
});
assert.notEqual(second.id, session.id);
const cancelled = await workCommands.cancel(agent, { projectId: project.id, sessionId: second.id, reason: 'Smoke test cleanup.' });
assert.equal(cancelled.status, 'cancelled');

console.log(JSON.stringify({ ok: true, projectId: project.id, sessionId: session.id, actions: completed.usage.actions, diff: completed.diff }));
