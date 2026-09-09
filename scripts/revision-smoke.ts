import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'keywords-revision-'));
process.env.KEYWORDS_DB_PATH = join(root, 'test.sqlite');
process.env.KEYWORDS_BLOG_ROOT = join(root, 'blog');
process.env.KEYWORDS_BLOG_BUILD_COMMAND = 'node -e "process.exit(0)"';
process.env.KEYWORDS_MAX_ARTICLE_REVISIONS = '5';
process.env.KEYWORDS_MAX_NO_PROGRESS_RETRIES = '1';

const { commands } = await import('@keywords/commands');
const { configureAutonomy } = await import('@keywords/commands/autonomy');
const { operationCommands } = await import('@keywords/commands/operation');
const { headlessCommands } = await import('@keywords/commands/headless');
const { revisionCommands } = await import('@keywords/commands/revision');
const { getDatabase } = await import('@keywords/db');
const { sqlite } = getDatabase();
const human = { actor: 'human' as const, actorId: 'revision-smoke-human' };
const t = () => new Date().toISOString();

const project = await commands.project.create(human, { name: 'Revision fixture', domain: 'revision.example.com' });
await configureAutonomy(human, { projectId: project.id, enabled: true });
const source = await commands.source.record(human, { projectId: project.id, type: 'web', label: 'Revision evidence', metadata: { document: { text: 'A persisted article should be revised only when the content or failed quality conditions require it.' } } });
const page = await commands.page.propose(human, { projectId: project.id, title: 'Revision State Machine', slug: 'revision-state-machine' });
sqlite.prepare("UPDATE pages SET source='workspace' WHERE id=?").run(page.id);
const started = await operationCommands.start(human, { requestText: 'Write revision state article', projectIds: [project.id], requestKey: 'revision-state-operation', constraints: { requiresArtifact: true, pageId: page.id } });
const operationId = started.operation.id as string;
const originalSessionId = started.children[0].workSessionId as string;
const content = `---\ntitle: Revision State Machine\n---\n# Revision State Machine\n\nA persisted article should be revised only when the content or failed quality conditions require it. Reusing the same operation and article identity prevents duplicate drafts while a deterministic gate requests local edits.`;
const artifact = await headlessCommands.writeDraft(human, { operationId, projectId: project.id, pageId: page.id, content, sourceIds: [source.id] });

const decisionId = 'revision-needs-edit-decision';
sqlite.prepare('INSERT INTO decisions(id,project_id,actor,action,target_type,target_id,verdict,reason,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(
  decisionId, project.id, 'system', 'page.autopilot_review', 'page', page.id, 'needs_edit', 'fixture', JSON.stringify({ fingerprint: 'gate-v1', gate: { reasons: ['reader_question_coverage'] } }), t()
);

const first = await revisionCommands.reconcile(project.id);
assert.equal(first.queued, 1);
const childAfterFirst = sqlite.prepare('SELECT * FROM operation_projects WHERE operation_id=? AND project_id=?').get(operationId, project.id) as any;
assert.notEqual(childAfterFirst.work_session_id, originalSessionId, 'revision must replace the original ended/idle work session');
const revisionSessionId = childAfterFirst.work_session_id as string;
assert.equal((sqlite.prepare('SELECT status FROM work_sessions WHERE id=?').get(originalSessionId) as any).status, 'cancelled');
assert.equal((sqlite.prepare('SELECT status FROM work_sessions WHERE id=?').get(revisionSessionId) as any).status, 'running');

const sessionCountBefore = Number((sqlite.prepare('SELECT COUNT(*) AS n FROM work_sessions WHERE project_id=?').get(project.id) as any).n);
const repeatedLive = await revisionCommands.reconcile(project.id);
assert.equal((repeatedLive.actions[0] as any).reused, true);
assert.equal((repeatedLive.actions[0] as any).reason, 'revision_session_active');
const sessionCountAfter = Number((sqlite.prepare('SELECT COUNT(*) AS n FROM work_sessions WHERE project_id=?').get(project.id) as any).n);
assert.equal(sessionCountAfter, sessionCountBefore, 'a live revision session must not be duplicated');

// Simulate a revision attempt ending without changing the persisted article or gate fingerprint.
sqlite.prepare("UPDATE work_sessions SET status='completed',completed_at=?,updated_at=? WHERE id=?").run(t(), t(), revisionSessionId);
sqlite.prepare("UPDATE operation_projects SET status='blocked',blocker_class='quality_revision_required',updated_at=? WHERE operation_id=? AND project_id=?").run(t(), operationId, project.id);
sqlite.prepare("UPDATE operation_requests SET status='blocked',updated_at=? WHERE id=?").run(t(), operationId);
const noProgress = await revisionCommands.reconcile(project.id);
assert.equal(noProgress.escalated, 1, 'same content + same gate after a revision attempt must hit the no-progress boundary');
assert.equal((sqlite.prepare('SELECT no_progress_count FROM operation_artifacts WHERE id=?').get(artifact.id) as any).no_progress_count, 1);
assert.equal((sqlite.prepare('SELECT status FROM operation_requests WHERE id=?').get(operationId) as any).status, 'awaiting_review');
assert.equal(Number((sqlite.prepare("SELECT COUNT(*) AS n FROM review_requests WHERE project_id=? AND target_type='operation_artifact' AND target_id=? AND status='open'").get(project.id, artifact.id) as any).n), 1);

// Explicit human pause is never overridden by automatic article resume.
const pausedProject = await commands.project.create(human, { name: 'Explicit pause fixture' });
await configureAutonomy(human, { projectId: pausedProject.id, enabled: true });
const pausedOp = await operationCommands.start(human, { requestText: 'Paused quality revision', projectIds: [pausedProject.id], requestKey: 'explicit-pause-revision' });
await operationCommands.checkpoint(human, { operationId: pausedOp.operation.id, projectId: pausedProject.id, state: 'blocked', blockerClass: 'quality_revision_required', summary: 'Needs a local article revision.' });
await operationCommands.setPause(human, { projectId: pausedProject.id, paused: true, reason: 'operator stop' });
await headlessCommands.resumeEligibleOperations();
const pausedContext = await operationCommands.context(human, { operationId: pausedOp.operation.id }) as any;
assert.equal(pausedContext.projects[0].status, 'blocked');
assert.equal(pausedContext.projects[0].blockerClass, 'quality_revision_required');

sqlite.close();
console.log(JSON.stringify({ ok: true, operationId, revisionSessionId, noProgressEscalated: true, explicitPausePreserved: true }));
