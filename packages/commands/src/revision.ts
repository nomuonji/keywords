import { randomUUID } from 'node:crypto';
import { getDatabase } from '@keywords/db';
import './headless.js';

const { sqlite } = getDatabase();
const now = () => new Date().toISOString();
const one = (sql: string, ...args: any[]): any => sqlite.prepare(sql).get(...args);
const rows = (sql: string, ...args: any[]): any[] => sqlite.prepare(sql).all(...args);
const run = (sql: string, ...args: any[]) => sqlite.prepare(sql).run(...args);
const parse = <T>(value: string | null | undefined, fallback: T): T => { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };

function openArtifactReview(projectId: string, artifact: any, reason: string) {
  const child = one('SELECT * FROM operation_projects WHERE operation_id=? AND project_id=?', artifact.operation_id, projectId);
  if (!child) return { escalated: false, reason: 'operation_project_missing' };
  const existing = one("SELECT id FROM review_requests WHERE project_id=? AND target_type='operation_artifact' AND target_id=? AND status='open' LIMIT 1", projectId, artifact.id);
  const t = now();
  let reviewId = existing?.id ?? null;
  sqlite.transaction(() => {
    if (!reviewId) {
      reviewId = randomUUID();
      run('INSERT INTO review_requests(id,project_id,work_session_id,target_type,target_id,title,question,options_json,status,requested_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        reviewId, projectId, child.work_session_id ?? null, 'operation_artifact', artifact.id, 'Article revision needs human decision', reason.slice(0, 2000), JSON.stringify(['review_failed_checks','stop_article']), 'open', 'autopilot-revision', t);
    }
    if (child.work_session_id) {
      run("UPDATE work_sessions SET status='awaiting_review',summary=?,last_next_action='await_human_decision',updated_at=? WHERE id=? AND status NOT IN ('completed','cancelled')", reason.slice(0, 2000), t, child.work_session_id);
      run('INSERT INTO work_checkpoints(id,session_id,state,summary,next_action,created_at) SELECT ?,id,?,?,?,? FROM work_sessions WHERE id=?', randomUUID(), 'awaiting_review', reason.slice(0, 2000), 'await_human_decision', t, child.work_session_id);
    }
    run("UPDATE operation_projects SET status='awaiting_review',blocker=?,blocker_class='human_decision_required',updated_at=? WHERE operation_id=? AND project_id=?", reason.slice(0, 2000), t, artifact.operation_id, projectId);
    run("UPDATE operation_requests SET status='awaiting_review',completed_at=NULL,updated_at=? WHERE id=?", t, artifact.operation_id);
    run('INSERT OR IGNORE INTO operation_events(id,operation_id,project_id,kind,severity,dedupe_key,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)', randomUUID(), artifact.operation_id, projectId, 'article_revision_escalated', 'warning', `revision:${artifact.id}:escalated`, JSON.stringify({ artifactId: artifact.id, pageId: artifact.page_id, reason }), t);
  }).immediate();
  return { escalated: true, reviewId, operationId: artifact.operation_id, artifactId: artifact.id };
}

function queueRevision(projectId: string, page: any, decision: any, artifact: any) {
  const parent = one('SELECT * FROM operation_requests WHERE id=?', artifact.operation_id);
  const child = one('SELECT * FROM operation_projects WHERE operation_id=? AND project_id=?', artifact.operation_id, projectId);
  if (!parent || !child) return { queued: false, reason: 'operation_missing' };

  // Never replace a work session while an executor still owns it.
  const activeExecutor = one("SELECT id FROM operation_executors WHERE current_operation_id=? AND current_project_id=? AND status='busy' AND lease_expires_at>? LIMIT 1", artifact.operation_id, projectId, now());
  if (activeExecutor) return { queued: true, reused: true, reason: 'executor_active', operationId: artifact.operation_id, workSessionId: child.work_session_id };

  const maxRevisions = Math.max(1, Number(process.env.KEYWORDS_MAX_ARTICLE_REVISIONS ?? 3));
  const maxNoProgress = Math.max(1, Number(process.env.KEYWORDS_MAX_NO_PROGRESS_RETRIES ?? 2));
  if (Number(artifact.revision_count ?? 0) >= maxRevisions) return openArtifactReview(projectId, artifact, `Article reached the revision limit (${artifact.revision_count}/${maxRevisions}) while the deterministic autonomy gate still requires edits.`);

  const metadata = parse<any>(decision.metadata_json, {});
  const fingerprint = String(metadata.fingerprint ?? decision.id);
  const lastQueued = one("SELECT payload_json FROM operation_events WHERE operation_id=? AND project_id=? AND kind='article_revision_queued' ORDER BY created_at DESC LIMIT 1", artifact.operation_id, projectId);
  const lastPayload = parse<any>(lastQueued?.payload_json, {});
  const currentSession = child.work_session_id ? one('SELECT * FROM work_sessions WHERE id=?', child.work_session_id) : null;

  // A previously-created revision session is idempotently reused while it is still live.
  if (lastPayload.sessionId && lastPayload.sessionId === child.work_session_id && currentSession?.status === 'running') {
    return { queued: true, reused: true, reason: 'revision_session_active', operationId: artifact.operation_id, workSessionId: child.work_session_id, artifactId: artifact.id };
  }

  // Count no-progress only after a prior revision attempt ended without changing either
  // the gate fingerprint or the persisted article hash.
  const repeatedWithoutProgress = Boolean(lastQueued && lastPayload.gateFingerprint === fingerprint && lastPayload.contentSha256 === artifact.content_sha256);
  if (repeatedWithoutProgress) {
    run('UPDATE operation_artifacts SET no_progress_count=no_progress_count+1,updated_at=? WHERE id=?', now(), artifact.id);
    artifact = one('SELECT * FROM operation_artifacts WHERE id=?', artifact.id);
    if (Number(artifact.no_progress_count ?? 0) >= maxNoProgress) return openArtifactReview(projectId, artifact, `The same article version failed the same autonomy gate ${artifact.no_progress_count} times without measurable progress.`);
  }

  const budget = parse<any>(parent.budget_json, {});
  const maxActions = Math.max(8, Math.min(Number(budget.maxActions ?? 24), 50));
  const reasons = Array.isArray(metadata?.gate?.reasons) ? metadata.gate.reasons : [];
  const summary = reasons.length ? `Revise article for autonomy gate: ${reasons.join('; ')}` : 'Revise the persisted article to satisfy the deterministic autonomy gate.';
  const sessionId = randomUUID();
  const t = now();
  sqlite.transaction(() => {
    if (currentSession && !['completed','cancelled'].includes(currentSession.status)) {
      run("UPDATE work_sessions SET status='cancelled',summary=?,last_next_action=NULL,updated_at=?,completed_at=? WHERE id=?", 'Superseded by deterministic article revision session.', t, t, currentSession.id);
      run('INSERT INTO work_checkpoints(id,session_id,state,summary,next_action,created_at) VALUES(?,?,?,?,?,?)', randomUUID(), currentSession.id, 'cancelled', 'Superseded by deterministic article revision session.', null, t);
    }
    run(`INSERT INTO work_sessions(id,project_id,actor_id,objective,completion_criteria_json,baseline_json,status,max_actions,summary,last_next_action,started_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, sessionId, projectId, 'autopilot-revision', `Revise article ${page.title}`, JSON.stringify(['Address only the persisted autonomy/validator failures.','Write the revised article through blog_writeDraft using the same operation and article identity.','Pass blog_validateDraft and the site build before completion.']), JSON.stringify({ operationId: artifact.operation_id, pageId: page.id, artifactId: artifact.id, gateFingerprint: fingerprint, contentSha256: artifact.content_sha256 }), 'running', maxActions, summary.slice(0,2000), 'read_blog_artifact_context_and_revise', t, t);
    run('INSERT INTO work_checkpoints(id,session_id,state,summary,next_action,created_at) VALUES(?,?,?,?,?,?)', randomUUID(), sessionId, 'working', summary.slice(0,2000), 'read_blog_artifact_context_and_revise', t);
    run("UPDATE operation_projects SET work_session_id=?,status='running',blocker=?,blocker_class='quality_revision_required',last_progress_at=COALESCE(last_progress_at,?),updated_at=? WHERE operation_id=? AND project_id=?", sessionId, summary.slice(0,2000), t, t, artifact.operation_id, projectId);
    if (child.task_id) run("UPDATE tasks SET status='doing',updated_at=? WHERE id=?", t, child.task_id);
    run("UPDATE operation_requests SET status='active',completed_at=NULL,updated_at=? WHERE id=?", t, artifact.operation_id);
    run('INSERT OR IGNORE INTO operation_events(id,operation_id,project_id,kind,severity,dedupe_key,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)', randomUUID(), artifact.operation_id, projectId, 'article_revision_queued', 'info', `revision:${artifact.id}:${fingerprint}:${artifact.content_sha256}:${Number(artifact.revision_count ?? 0)}:${Number(artifact.no_progress_count ?? 0)}`, JSON.stringify({ artifactId: artifact.id, pageId: page.id, gateFingerprint: fingerprint, contentSha256: artifact.content_sha256, revisionCount: Number(artifact.revision_count ?? 0), noProgressCount: Number(artifact.no_progress_count ?? 0), sessionId }), t);
  }).immediate();
  return { queued: true, reused: false, operationId: artifact.operation_id, workSessionId: sessionId, artifactId: artifact.id };
}

function reconcileProject(projectId: string) {
  const proposed = rows("SELECT id,title FROM pages WHERE project_id=? AND source='workspace' AND status='proposed' ORDER BY updated_at", projectId);
  const actions: any[] = [];
  for (const page of proposed) {
    const decision = one("SELECT * FROM decisions WHERE project_id=? AND target_type='page' AND target_id=? AND action='page.autopilot_review' AND verdict='needs_edit' ORDER BY created_at DESC LIMIT 1", projectId, page.id);
    if (!decision) continue;
    const artifact = one("SELECT * FROM operation_artifacts WHERE project_id=? AND page_id=? ORDER BY updated_at DESC LIMIT 1", projectId, page.id);
    if (!artifact) { actions.push({ pageId: page.id, queued: false, reason: 'artifact_not_written_yet' }); continue; }
    actions.push({ pageId: page.id, ...queueRevision(projectId, page, decision, artifact) });
  }
  return actions;
}

export const revisionCommands = {
  reconcile: async (projectId?: string) => {
    const projectIds = projectId ? [projectId] : rows('SELECT project_id FROM autopilot_controls WHERE enabled=1').map(row => String(row.project_id));
    const actions = projectIds.flatMap(id => reconcileProject(id));
    return { generatedAt: now(), actions, queued: actions.filter(action => action.queued).length, escalated: actions.filter(action => action.escalated).length };
  }
};
