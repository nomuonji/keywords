import { randomUUID } from 'node:crypto';
import { getDatabase } from '@keywords/db';
import type { CommandContext, DiscoveryDemandPolicy } from '@keywords/domain';
import { blogCommands } from './blog.js';
import { assertHuman, assertOperationAllowed, fingerprint, listDelegations, operationControl, projectExists, setOperationPause } from './guard.js';
import { headlessCommands } from './headless.js';
import { googleAdsConfigured } from './workspace.js';
import { isVerifiedDemand } from './discovery-policy.js';
import { snapshotCounts, workCommands } from './work.js';

const { sqlite } = getDatabase();
const now = () => new Date().toISOString();
const one = (sql: string, ...args: any[]): any => sqlite.prepare(sql).get(...args);
const rows = (sql: string, ...args: any[]) => sqlite.prepare(sql).all(...args) as any[];
const run = (sql: string, ...args: any[]) => sqlite.prepare(sql).run(...args);
const parse = <T>(value: string | null | undefined, fallback: T): T => { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
function required(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const normalizeText = (value: string) => value.trim().replace(/\s+/g, ' ');
const leaseUntil = (seconds?: number) => new Date(Date.now() + Math.max(60, Math.min(Math.floor(seconds ?? 300), 3600)) * 1000).toISOString();

interface OperationStartInput {
  requestText: string;
  requestKey?: string;
  conversationRef?: string;
  objective?: string;
  projectIds?: string[];
  scope?: 'single' | 'portfolio';
  completionCriteria?: string[];
  constraints?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  assumptions?: string[];
  budget?: { maxActions?: number; maxExternalRequests?: number; maxCandidateWrites?: number; maxProjects?: number; maxRuntimeMinutes?: number; maxKnownCost?: number };
}

function audit(ctx: CommandContext, command: string, projectId: string | null, workSessionId: string | null, input: unknown, output: unknown, error?: unknown) {
  run('INSERT INTO runs(id,project_id,work_session_id,actor,actor_id,command,status,input_json,output_json,error,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    randomUUID(), projectId, workSessionId, ctx.actor, ctx.actorId ?? null, command, error ? 'failed' : 'succeeded', JSON.stringify(input ?? null), error ? null : JSON.stringify(output ?? null), error ? (error instanceof Error ? error.message : String(error)).slice(0, 1000) : null, now());
}

function projectScore(project: any) {
  const gsc = one("SELECT created_at FROM sources WHERE project_id=? AND type='gsc_snapshot' ORDER BY created_at DESC LIMIT 1", project.id);
  const binding = one('SELECT observed_at FROM blog_bindings WHERE project_id=?', project.id);
  const task = one("SELECT priority FROM tasks WHERE project_id=? AND assignee_type='agent' AND status!='done' ORDER BY priority DESC LIMIT 1", project.id);
  return (gsc ? 50 : 0) + (binding ? 30 : 0) + Number(task?.priority ?? 0) / 10 + (project.mode === 'existing_site' ? 5 : 0);
}

function selectProjects(input: OperationStartInput) {
  const explicit = [...new Set((input.projectIds ?? []).map(x => x.trim()).filter(Boolean))];
  if (explicit.length) return explicit.map(id => projectExists(id).id as string);
  const all = rows('SELECT * FROM projects ORDER BY updated_at DESC');
  required(all.length, 'No projects are available');
  const maxProjects = Math.max(1, Math.min(Math.floor(input.budget?.maxProjects ?? (input.scope === 'portfolio' ? 3 : 1)), 20));
  return all.sort((a, b) => projectScore(b) - projectScore(a)).slice(0, maxProjects).map(project => String(project.id));
}

function unfinishedSession(projectId: string) {
  return one("SELECT * FROM work_sessions WHERE project_id=? AND status IN ('running','awaiting_review','blocked') ORDER BY updated_at DESC LIMIT 1", projectId);
}

function operationRow(id: string) { return one('SELECT * FROM operation_requests WHERE id=?', id); }

function outcomeView(row: any) {
  return {
    id: row.id, operationId: row.operation_id, projectId: row.project_id, targetUrl: row.target_url, handoffId: row.handoff_id,
    hypothesis: row.hypothesis, implementedAt: row.implemented_at, publishedAt: row.published_at, evaluationDueAt: row.evaluation_due_at,
    status: row.outcome_status, metrics: parse(row.metrics_json, {}), attributionNotes: row.attribution_notes, nextAction: row.next_action,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function operationView(id: string) {
  const op = operationRow(id); required(op, 'Operation not found');
  const projects = rows(`SELECT op.*,p.name,p.domain,ws.objective AS work_objective,ws.status AS work_status,ws.summary AS work_summary,ws.last_next_action,
    t.title AS task_title,t.status AS task_status,t.priority AS task_priority
    FROM operation_projects op JOIN projects p ON p.id=op.project_id
    LEFT JOIN work_sessions ws ON ws.id=op.work_session_id LEFT JOIN tasks t ON t.id=op.task_id
    WHERE op.operation_id=? ORDER BY p.name`, id).map(row => ({
      projectId: row.project_id, name: row.name, domain: row.domain, status: row.status, blocker: row.blocker, blockerClass: row.blocker_class ?? null,
      lastProgressAt: row.last_progress_at ?? null, runtimeConsumedMs: Number(row.runtime_consumed_ms ?? 0),
      workSessionId: row.work_session_id, taskId: row.task_id,
      work: row.work_session_id ? { objective: row.work_objective, status: row.work_status, summary: row.work_summary, nextAction: row.last_next_action } : null,
      task: row.task_id ? { title: row.task_title, status: row.task_status, priority: row.task_priority } : null
    }));
  const events = rows('SELECT * FROM operation_events WHERE operation_id=? ORDER BY created_at DESC LIMIT 30', id).map(row => ({ id: row.id, kind: row.kind, severity: row.severity, payload: parse(row.payload_json, {}), createdAt: row.created_at, acknowledgedAt: row.acknowledged_at }));
  const outcomes = rows('SELECT * FROM operation_outcomes WHERE operation_id=? ORDER BY updated_at DESC', id).map(outcomeView);
  return {
    id: op.id, requestKey: op.request_key, requestText: op.request_text, objective: op.objective,
    constraints: parse(op.constraints_json, {}), permissions: parse(op.permissions_json, {}), budget: parse(op.budget_json, {}), assumptions: parse(op.assumptions_json, []),
    conversationRef: op.conversation_ref, status: op.status, createdBy: op.created_by, createdAt: op.created_at, updatedAt: op.updated_at, completedAt: op.completed_at,
    projects, events, outcomes
  };
}

function emitEvent(input: { operationId?: string | null; projectId?: string | null; kind: string; severity?: 'info' | 'warning' | 'error'; key: string; payload: unknown }) {
  const existing = one('SELECT id FROM operation_events WHERE dedupe_key=?', input.key); if (existing) return existing.id as string;
  const eventId = randomUUID();
  run('INSERT INTO operation_events(id,operation_id,project_id,kind,severity,dedupe_key,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)', eventId, input.operationId ?? null, input.projectId ?? null, input.kind, input.severity ?? 'info', input.key, JSON.stringify(input.payload ?? null), now());
  return eventId;
}

async function createChildWork(ctx: CommandContext, operationId: string, projectId: string, objective: string, criteria: string[], maxActions: number) {
  const existing = unfinishedSession(projectId);
  let sessionId: string | null = null, childStatus = 'queued', blocker: string | null = null, blockerClass: string | null = null;
  if (existing) {
    sessionId = existing.id; childStatus = existing.status === 'running' ? 'running' : existing.status;
    blocker = existing.status === 'running' ? null : `Existing work session is ${existing.status}`;
    blockerClass = existing.status === 'awaiting_review' ? 'human_decision_required' : existing.status === 'blocked' ? 'site_dependency_failed' : null;
  } else {
    sessionId = randomUUID(); const t = now(); const baseline = await snapshotCounts(projectId);
    run(`INSERT INTO work_sessions(id,project_id,actor_id,objective,completion_criteria_json,baseline_json,status,max_actions,summary,last_next_action,started_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, sessionId, projectId, ctx.actorId ?? null, objective, JSON.stringify(criteria), JSON.stringify(baseline), 'running', maxActions, null, 'operation_context', t, t);
    run('INSERT INTO work_checkpoints(id,session_id,state,summary,next_action,created_at) VALUES(?,?,?,?,?,?)', randomUUID(), sessionId, 'working', `Operation ${operationId} started`, 'operation_context', t);
    childStatus = 'running';
  }
  const existingTask = one("SELECT * FROM tasks WHERE project_id=? AND related_type='operation' AND related_id=? AND status!='done' ORDER BY updated_at DESC LIMIT 1", projectId, operationId);
  const taskId = existingTask?.id ?? randomUUID();
  if (!existingTask) {
    const t = now(); run('INSERT INTO tasks(id,project_id,title,description,status,priority,assignee_type,related_type,related_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', taskId, projectId, objective.slice(0, 240), `Agent-driven operation ${operationId}`, 'doing', 90, 'agent', 'operation', operationId, t, t);
  }
  run(`INSERT INTO operation_projects(operation_id,project_id,work_session_id,task_id,status,blocker,blocker_class,last_progress_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(operation_id,project_id) DO UPDATE SET work_session_id=excluded.work_session_id,task_id=excluded.task_id,status=excluded.status,blocker=excluded.blocker,blocker_class=excluded.blocker_class,updated_at=excluded.updated_at`, operationId, projectId, sessionId, taskId, childStatus, blocker, blockerClass, now(), now());
  return { projectId, workSessionId: sessionId, taskId, status: childStatus, reusedSession: Boolean(existing), blocker, blockerClass };
}

function executorView(row: any) {
  if (!row) return null;
  const health = headlessCommands.executorHealth(String(row.id));
  return { id: row.id, kind: row.kind, status: health?.status ?? row.status, runnable: health?.runnable ?? false, capabilities: parse(row.capabilities_json, []), currentOperationId: row.current_operation_id, currentProjectId: row.current_project_id, generation: row.generation, lastSeenAt: row.last_seen_at, leaseExpiresAt: row.lease_expires_at, connected: Boolean(row.last_seen_at && Date.now() - Date.parse(row.last_seen_at) < 10 * 60_000), failureClass: health?.failureClass ?? null, cooldownUntil: health?.cooldownUntil ?? null, lastError: health?.lastError ?? null };
}

function statusForProject(projectId: string) {
  const review = one("SELECT id,title,question,created_at FROM review_requests WHERE project_id=? AND status='open' ORDER BY created_at DESC LIMIT 1", projectId);
  const work = unfinishedSession(projectId); const executor = one('SELECT * FROM operation_executors WHERE current_project_id=? ORDER BY last_seen_at DESC LIMIT 1', projectId); const latestOutcome = one('SELECT * FROM operation_outcomes WHERE project_id=? ORDER BY updated_at DESC LIMIT 1', projectId);
  return { review: review ?? null, work: work ? { id: work.id, objective: work.objective, status: work.status, summary: work.summary, nextAction: work.last_next_action, updatedAt: work.updated_at } : null, executor: executorView(executor), latestOutcome: latestOutcome ? outcomeView(latestOutcome) : null, control: operationControl(projectId) };
}

export const operationCommands = {
  recordRuntime: async (ctx: CommandContext, input: { executorId: string; generation: number; operationId: string; projectId: string }) => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('Runtime recording requires an executor');
    return sqlite.transaction(() => {
      const executor = one('SELECT * FROM operation_executors WHERE id=? AND generation=? AND current_operation_id=? AND current_project_id=?', input.executorId, input.generation, input.operationId, input.projectId);
      required(executor, 'Runtime recording rejected because executor ownership changed');
      const child = one('SELECT runtime_started_at,runtime_consumed_ms,work_session_id FROM operation_projects WHERE operation_id=? AND project_id=?', input.operationId, input.projectId);
      required(child, 'Operation project not found');
      if (!child.runtime_started_at) return { recorded: false, elapsedMs: 0, consumedMs: Number(child.runtime_consumed_ms ?? 0) };
      const end = executor.lease_expires_at ? Math.min(Date.now(), Date.parse(executor.lease_expires_at)) : Date.now();
      const elapsedMs = Math.max(0, end - Date.parse(child.runtime_started_at));
      required(Number.isFinite(elapsedMs), 'Invalid executor runtime timestamp');
      run('UPDATE operation_projects SET runtime_consumed_ms=runtime_consumed_ms+?,runtime_started_at=NULL,updated_at=? WHERE operation_id=? AND project_id=?', elapsedMs, now(), input.operationId, input.projectId);
      const output = { recorded: true, elapsedMs, consumedMs: Number(child.runtime_consumed_ms ?? 0) + elapsedMs };
      audit(ctx, 'operation.runtime', input.projectId, child.work_session_id, input, output);
      return output;
    }).immediate();
  },
  context: async (_ctx: CommandContext, input: { projectId?: string; operationId?: string }) => {
    if (input.operationId) return operationView(input.operationId);
    if (input.projectId) {
      projectExists(input.projectId);
      const active = one("SELECT o.id FROM operation_requests o JOIN operation_projects op ON op.operation_id=o.id WHERE op.project_id=? AND o.status IN ('active','awaiting_review','blocked') ORDER BY o.updated_at DESC LIMIT 1", input.projectId);
      const reviews = rows("SELECT id,title,question,options_json,work_session_id,target_type,target_id,created_at FROM review_requests WHERE project_id=? AND status='open' ORDER BY created_at DESC LIMIT 10", input.projectId).map(row => ({ ...row, options: parse(row.options_json, []) }));
      const recentEvents = rows('SELECT * FROM operation_events WHERE project_id=? ORDER BY created_at DESC LIMIT 20', input.projectId).map(row => ({ id: row.id, kind: row.kind, severity: row.severity, payload: parse(row.payload_json, {}), createdAt: row.created_at }));
      return { generatedAt: now(), project: projectExists(input.projectId), ...statusForProject(input.projectId), activeOperation: active ? operationView(active.id) : null, reviews, recentEvents, delegations: listDelegations(input.projectId) };
    }
    const projects = rows('SELECT id,name,domain FROM projects ORDER BY updated_at DESC').map(project => ({ ...project, ...statusForProject(project.id) }));
    const reviews = rows("SELECT rr.id,rr.project_id,rr.title,rr.question,rr.created_at,p.name FROM review_requests rr JOIN projects p ON p.id=rr.project_id WHERE rr.status='open' ORDER BY rr.created_at DESC LIMIT 20");
    const activeOperations = rows("SELECT id FROM operation_requests WHERE status IN ('active','awaiting_review','blocked') ORDER BY updated_at DESC LIMIT 20").map(row => operationView(row.id));
    const outcomes = rows("SELECT * FROM operation_outcomes WHERE outcome_status IN ('improved','regressed','inconclusive','unmeasurable','pending') ORDER BY updated_at DESC LIMIT 20").map(outcomeView);
    return { generatedAt: now(), projects, reviews, activeOperations, outcomes };
  },

  start: async (ctx: CommandContext, input: OperationStartInput) => {
    const requestText = normalizeText(input.requestText); required(requestText, 'Operation request text is required');
    if (input.conversationRef) { const continued = one("SELECT id FROM operation_requests WHERE conversation_ref=? AND status IN ('active','awaiting_review','blocked') ORDER BY updated_at DESC LIMIT 1", input.conversationRef); if (continued) return { reused: true, operation: operationView(continued.id), reason: 'active_conversation_operation' }; }
    const projectIds = selectProjects(input); for (const projectId of projectIds) assertOperationAllowed(ctx, { projectId, command: 'operation.start', capability: 'operation.start' });
    const requestKey = input.requestKey?.trim() || fingerprint({ requestText: requestText.toLowerCase(), projectIds: [...projectIds].sort(), conversationRef: input.conversationRef ?? null });
    const duplicate = one('SELECT id FROM operation_requests WHERE request_key=?', requestKey); if (duplicate) return { reused: true, operation: operationView(duplicate.id), reason: 'idempotency_key' };
    const objective = normalizeText(input.objective ?? requestText).slice(0, 1000);
    const criteria = (input.completionCriteria ?? ['Produce one evidence-backed result or a concrete blocker.', 'Preserve approval and publication boundaries.', 'Leave a measurable next condition.']).map(normalizeText).filter(Boolean).slice(0, 10);
    const budget = { maxActions: Math.max(1, Math.min(Math.floor(input.budget?.maxActions ?? 12), 100)), maxExternalRequests: Math.max(0, Math.min(Math.floor(input.budget?.maxExternalRequests ?? 8), 100)), maxCandidateWrites: Math.max(0, Math.min(Math.floor(input.budget?.maxCandidateWrites ?? 50), 1000)), maxProjects: projectIds.length, maxRuntimeMinutes: Math.max(1, Math.min(Math.floor(input.budget?.maxRuntimeMinutes ?? 30), 1440)), maxKnownCost: input.budget?.maxKnownCost ?? 0 };
    const operationId = randomUUID(); const t = now();
    sqlite.transaction(() => { run('INSERT INTO operation_requests(id,request_key,request_text,objective,constraints_json,permissions_json,budget_json,assumptions_json,conversation_ref,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', operationId, requestKey, requestText, objective, JSON.stringify(input.constraints ?? {}), JSON.stringify(input.permissions ?? {}), JSON.stringify(budget), JSON.stringify(input.assumptions ?? []), input.conversationRef ?? null, 'active', ctx.actorId ?? ctx.actor, t, t); }).immediate();
    const children = [];
    for (const projectId of projectIds) children.push(await createChildWork(ctx, operationId, projectId, objective, criteria, budget.maxActions));
    emitEvent({ operationId, kind: 'operation_started', key: `operation:${operationId}:started`, payload: { projectIds, objective } });
    const result = { reused: false, children, operation: operationView(operationId) }; audit(ctx, 'operation.start', projectIds[0] ?? null, children[0]?.workSessionId ?? null, input, { operationId, projectIds }); return result;
  },

  resume: async (ctx: CommandContext, input: { operationId: string; projectId?: string }) => {
    required(operationRow(input.operationId), 'Operation not found');
    const children = rows('SELECT * FROM operation_projects WHERE operation_id=?', input.operationId).filter(row => !input.projectId || row.project_id === input.projectId); required(children.length, 'Operation has no matching project');
    let resumed = 0;
    for (const child of children) {
      assertOperationAllowed(ctx, { projectId: child.project_id, command: 'operation.resume', capability: 'operation.start', allowWhilePaused: false });
      const human = ctx.actor === 'human';
      if (!human && child.status === 'blocked' && !headlessCommands.canAutoResumeBlocker(child.blocker_class)) continue;
      if (!human && child.status === 'awaiting_review' && child.blocker_class && child.blocker_class !== 'quality_revision_required') continue;
      if (child.work_session_id) {
        const session = one('SELECT * FROM work_sessions WHERE id=?', child.work_session_id);
        if (session && ['awaiting_review','blocked'].includes(session.status)) {
          const openReview = one("SELECT id FROM review_requests WHERE work_session_id=? AND status='open' LIMIT 1", session.id); if (openReview) continue;
          run("UPDATE work_sessions SET status='running',updated_at=? WHERE id=?", now(), session.id);
          run('INSERT INTO work_checkpoints(id,session_id,state,summary,next_action,created_at) VALUES(?,?,?,?,?,?)', randomUUID(), session.id, 'working', 'Operation resumed.', session.last_next_action, now());
        }
      }
      run("UPDATE operation_projects SET status='running',blocker=NULL,blocker_class=NULL,updated_at=? WHERE operation_id=? AND project_id=?", now(), input.operationId, child.project_id); resumed++;
    }
    if (resumed > 0) {
      run("UPDATE operation_requests SET status='active',updated_at=? WHERE id=?", now(), input.operationId);
      emitEvent({ operationId: input.operationId, projectId: input.projectId ?? null, kind: 'operation_resumed', key: `operation:${input.operationId}:resume:${Date.now()}`, payload: { projectId: input.projectId ?? null, resumed } });
    }
    return operationView(input.operationId);
  },

  checkpoint: async (ctx: CommandContext, input: { operationId: string; projectId: string; state: 'working' | 'awaiting_review' | 'blocked'; summary: string; nextAction?: string; blockerClass?: 'quality_revision_required'|'site_dependency_failed'|'executor_unavailable'|'human_decision_required'|'explicit_pause'|'budget_exhausted'|'artifact_missing' }) => {
    assertOperationAllowed(ctx, { projectId: input.projectId, command: 'operation.checkpoint', capability: 'operation.start', allowWhilePaused: true });
    const child = one('SELECT * FROM operation_projects WHERE operation_id=? AND project_id=?', input.operationId, input.projectId); required(child, 'Operation project not found');
    const summary = normalizeText(input.summary); required(summary, 'Checkpoint summary is required');
    const blockerClass = input.state === 'working' ? null : input.blockerClass ?? (input.state === 'awaiting_review' ? 'human_decision_required' : 'site_dependency_failed');
    if (child.work_session_id) {
      run('INSERT INTO work_checkpoints(id,session_id,state,summary,next_action,created_at) VALUES(?,?,?,?,?,?)', randomUUID(), child.work_session_id, input.state, summary.slice(0, 2000), input.nextAction?.trim() || null, now());
      run('UPDATE work_sessions SET status=?,summary=?,last_next_action=?,updated_at=? WHERE id=?', input.state === 'working' ? 'running' : input.state, summary.slice(0, 2000), input.nextAction?.trim() || null, now(), child.work_session_id);
    }
    run('UPDATE operation_projects SET status=?,blocker=?,blocker_class=?,last_progress_at=CASE WHEN ?=\'working\' THEN ? ELSE last_progress_at END,updated_at=? WHERE operation_id=? AND project_id=?', input.state === 'working' ? 'running' : input.state, input.state === 'blocked' ? summary : null, blockerClass, input.state, now(), now(), input.operationId, input.projectId);
    if (input.state !== 'working') run('UPDATE operation_requests SET status=?,updated_at=? WHERE id=?', input.state, now(), input.operationId);
    if (input.state === 'blocked') emitEvent({ operationId: input.operationId, projectId: input.projectId, kind: 'major_failure', severity: blockerClass === 'quality_revision_required' || blockerClass === 'artifact_missing' ? 'warning' : 'error', key: `operation:${input.operationId}:blocked:${fingerprint(`${blockerClass}:${summary}`)}`, payload: { summary, nextAction: input.nextAction ?? null, blockerClass } });
    return operationView(input.operationId);
  },

  complete: async (ctx: CommandContext, input: { operationId: string; summary: string }) => {
    const op = operationRow(input.operationId); required(op, 'Operation not found');
    if (op.status === 'completed') return operationView(input.operationId);
    const pending = one(`SELECT rr.id FROM review_requests rr JOIN operation_projects child ON child.work_session_id=rr.work_session_id WHERE child.operation_id=? AND rr.status='open' LIMIT 1`, input.operationId);
    if (pending || op.status === 'awaiting_review' || op.status === 'blocked') throw new Error('Resume the operation after resolving its boundary before completing it');
    headlessCommands.assertCompletion(input.operationId);
    const children = rows('SELECT * FROM operation_projects WHERE operation_id=?', input.operationId);
    for (const child of children) {
      assertOperationAllowed(ctx, { projectId: child.project_id, command: 'operation.complete', capability: 'operation.start', allowWhilePaused: true });
      if (child.work_session_id) {
        const session = one('SELECT * FROM work_sessions WHERE id=?', child.work_session_id);
        if (session && !['completed','cancelled'].includes(session.status)) {
          await workCommands.complete(ctx, {projectId:child.project_id,sessionId:session.id,summary:normalizeText(input.summary).slice(0,3000)});
        }
      }
      if (child.task_id) run("UPDATE tasks SET status='done',updated_at=? WHERE id=?", now(), child.task_id);
      run("UPDATE operation_projects SET status='completed',blocker=NULL,blocker_class=NULL,last_progress_at=?,updated_at=? WHERE operation_id=? AND project_id=?", now(), now(), input.operationId, child.project_id);
    }
    run("UPDATE operation_requests SET status='completed',updated_at=?,completed_at=? WHERE id=?", now(), now(), input.operationId);
    emitEvent({ operationId: input.operationId, kind: 'operation_completed', key: `operation:${input.operationId}:completed`, payload: { summary: normalizeText(input.summary) } });
    audit(ctx, 'operation.complete', children[0]?.project_id ?? null, children[0]?.work_session_id ?? null, input, { operationId: input.operationId, completed: true });
    return operationView(input.operationId);
  },

  startDiscovery: async (ctx: CommandContext, input: { operationId: string; projectId: string; seedKeywords?: string[]; targetUrl?: string; goal: string; language?: string; country?: string; region?: string; excludedTerms?: string[]; maxCandidates?: number; maxExternalRequests?: number; demandPolicy?: DiscoveryDemandPolicy }) => {
    assertOperationAllowed(ctx, { projectId: input.projectId, command: 'discovery.start', capability: 'discovery.start' });
    const child = one('SELECT * FROM operation_projects WHERE operation_id=? AND project_id=?', input.operationId, input.projectId); required(child, 'Project is not part of this operation');
    const project = projectExists(input.projectId); const seeds = [...new Set((input.seedKeywords ?? []).map(normalizeText).filter(Boolean))]; const targetUrl = input.targetUrl?.trim() || null; required(seeds.length || targetUrl, 'At least one seed keyword or target URL is required');
    const demandPolicy = input.demandPolicy ?? 'required';
    if (demandPolicy === 'required' && !googleAdsConfigured()) throw new Error('Search-volume discovery requires Google Ads Keyword Planner credentials or GOOGLE_ADS_KEYWORD_VOLUME_API_URL/KEYWORD_VOLUME_API_URL. SERP observations alone are not enough.');
    const active = one("SELECT * FROM discovery_jobs WHERE project_id=? AND status IN ('waiting_for_agent','running','awaiting_review','blocked') ORDER BY updated_at DESC LIMIT 1", input.projectId); if (active) return { reused: true, jobId: active.id, status: active.status, taskId: active.task_id };
    const jobId = randomUUID(), taskId = randomUUID(), t = now(); const maxCandidates = Math.max(1, Math.min(Math.floor(input.maxCandidates ?? 50), 500)); const maxExternal = Math.max(1, Math.min(Math.floor(input.maxExternalRequests ?? 8), 50));
    sqlite.transaction(() => {
      run('INSERT INTO tasks(id,project_id,title,description,status,priority,assignee_type,related_type,related_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', taskId, input.projectId, `キーワード探索: ${normalizeText(input.goal)}`, `Discovery job ${jobId}; operation ${input.operationId}`, 'todo', 80, 'agent', 'discovery_job', jobId, t, t);
      run(`INSERT INTO discovery_jobs(id,project_id,seed_keywords_json,target_url,goal,language,country,region,excluded_terms_json,demand_policy,max_candidates,candidate_writes_used,max_external_requests,external_requests_used,status,task_id,work_session_id,executor_id,heartbeat_at,lease_expires_at,started_at,completed_at,error,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, jobId, input.projectId, JSON.stringify(seeds), targetUrl, normalizeText(input.goal), (input.language ?? project.language ?? 'ja').toLowerCase(), (input.country ?? project.country ?? 'jp').toLowerCase(), input.region ?? project.region ?? null, JSON.stringify(input.excludedTerms ?? []), demandPolicy, maxCandidates, 0, maxExternal, 0, 'waiting_for_agent', taskId, child.work_session_id ?? null, null, null, null, null, null, null, t, t);
    }).immediate();
    emitEvent({ operationId: input.operationId, projectId: input.projectId, kind: 'discovery_queued', key: `operation:${input.operationId}:discovery:${jobId}`, payload: { jobId, goal: input.goal } }); return { reused: false, jobId, taskId, status: 'waiting_for_agent' };
  },

  triageCandidates: async (ctx: CommandContext, input: { operationId: string; projectId: string; jobId: string; candidateIds: string[]; status: 'shortlisted' | 'hold' | 'rejected' | 'research_more'; reason: string }) => {
    assertOperationAllowed(ctx, { projectId: input.projectId, command: 'operation.candidate_triage', capability: 'candidate.triage' }); required(one('SELECT 1 FROM operation_projects WHERE operation_id=? AND project_id=?', input.operationId, input.projectId), 'Project is not part of this operation');
    const ids = [...new Set(input.candidateIds)].slice(0, 200); required(ids.length, 'No candidate IDs supplied');
    if (input.status === 'shortlisted') {
      const unverified = ids.map(candidateId => one('SELECT keyword,demand_status,demand_value FROM discovery_candidates WHERE id=? AND job_id=? AND project_id=?', candidateId, input.jobId, input.projectId)).filter(row => row && !isVerifiedDemand(row.demand_status, row.demand_value));
      if (unverified.length) throw new Error(`Candidates cannot be shortlisted without verified demand: ${unverified.map(row => row.keyword).join(', ')}`);
    }
    let changed = 0; const t = now();
    sqlite.transaction(() => { for (const candidateId of ids) { const result = run('UPDATE discovery_candidates SET status=?,updated_at=? WHERE id=? AND job_id=? AND project_id=?', input.status, t, candidateId, input.jobId, input.projectId); if (result.changes) { changed++; run('INSERT INTO decisions(id,project_id,actor,action,target_type,target_id,verdict,reason,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', randomUUID(), input.projectId, ctx.actor, 'operation.candidate_triage', 'discovery_candidate', candidateId, input.status, normalizeText(input.reason).slice(0, 1000), JSON.stringify({ operationId: input.operationId, jobId: input.jobId }), t); } } }).immediate(); return { changed, status: input.status };
  },

  prepareBlogHandoff: async (ctx: CommandContext, input: { operationId: string; projectId: string; pageId: string }) => {
    assertOperationAllowed(ctx, { projectId: input.projectId, command: 'blog.export', capability: 'blog.transport' }); required(one('SELECT 1 FROM operation_projects WHERE operation_id=? AND project_id=?', input.operationId, input.projectId), 'Project is not part of this operation');
    const payload = await blogCommands.export({ ...ctx, projectId: input.projectId }, { projectId: input.projectId, pageId: input.pageId }); emitEvent({ operationId: input.operationId, projectId: input.projectId, kind: 'handoff_ready', key: `operation:${input.operationId}:handoff:${payload.handoff_id}`, payload: { handoffId: payload.handoff_id, pageId: input.pageId, publicationAuthorized: false } }); return { handoff: payload, transport: 'direct_command_payload', publicationAuthorized: false };
  },

  recordOutcome: async (ctx: CommandContext, input: { operationId?: string; projectId: string; targetUrl?: string; handoffId?: string; hypothesis?: string; implementedAt?: string; publishedAt?: string; evaluationDueAt?: string; status: 'pending' | 'improved' | 'regressed' | 'inconclusive' | 'unmeasurable'; metrics?: Record<string, unknown>; attributionNotes?: string; nextAction?: string }) => {
    assertOperationAllowed(ctx, { projectId: input.projectId, command: 'operation.outcome', capability: 'outcome.record', allowWhilePaused: true }); if (input.operationId) required(one('SELECT 1 FROM operation_projects WHERE operation_id=? AND project_id=?', input.operationId, input.projectId), 'Project is not part of this operation');
    const existing = input.handoffId ? one('SELECT * FROM operation_outcomes WHERE project_id=? AND handoff_id=? ORDER BY updated_at DESC LIMIT 1', input.projectId, input.handoffId) : null; const id = existing?.id ?? randomUUID(), t = now();
    if (existing) run('UPDATE operation_outcomes SET operation_id=?,target_url=?,hypothesis=?,implemented_at=?,published_at=?,evaluation_due_at=?,outcome_status=?,metrics_json=?,attribution_notes=?,next_action=?,updated_at=? WHERE id=?', input.operationId ?? existing.operation_id, input.targetUrl ?? existing.target_url, input.hypothesis ?? existing.hypothesis, input.implementedAt ?? existing.implemented_at, input.publishedAt ?? existing.published_at, input.evaluationDueAt ?? existing.evaluation_due_at, input.status, JSON.stringify(input.metrics ?? parse(existing.metrics_json, {})), input.attributionNotes ?? existing.attribution_notes, input.nextAction ?? existing.next_action, t, id);
    else run('INSERT INTO operation_outcomes(id,operation_id,project_id,target_url,handoff_id,hypothesis,implemented_at,published_at,evaluation_due_at,outcome_status,metrics_json,attribution_notes,next_action,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, input.operationId ?? null, input.projectId, input.targetUrl ?? null, input.handoffId ?? null, input.hypothesis ?? null, input.implementedAt ?? null, input.publishedAt ?? null, input.evaluationDueAt ?? null, input.status, JSON.stringify(input.metrics ?? {}), input.attributionNotes ?? null, input.nextAction ?? null, t, t);
    if (['improved','regressed','unmeasurable'].includes(input.status)) emitEvent({ operationId: input.operationId ?? null, projectId: input.projectId, kind: 'meaningful_outcome', severity: input.status === 'regressed' ? 'warning' : 'info', key: `outcome:${id}:${input.status}`, payload: { outcomeId: id, status: input.status, nextAction: input.nextAction ?? null } }); return outcomeView(one('SELECT * FROM operation_outcomes WHERE id=?', id));
  },

  listOutcomes: async (_ctx: CommandContext, input: { projectId?: string; status?: string; limit?: number }) => { const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 50), 200)); if (input.projectId && input.status) return rows('SELECT * FROM operation_outcomes WHERE project_id=? AND outcome_status=? ORDER BY updated_at DESC LIMIT ?', input.projectId, input.status, limit).map(outcomeView); if (input.projectId) return rows('SELECT * FROM operation_outcomes WHERE project_id=? ORDER BY updated_at DESC LIMIT ?', input.projectId, limit).map(outcomeView); if (input.status) return rows('SELECT * FROM operation_outcomes WHERE outcome_status=? ORDER BY updated_at DESC LIMIT ?', input.status, limit).map(outcomeView); return rows('SELECT * FROM operation_outcomes ORDER BY updated_at DESC LIMIT ?', limit).map(outcomeView); },
  setPause: async (ctx: CommandContext, input: { projectId: string; paused: boolean; reason?: string }) => setOperationPause(ctx, input),
  delegationList: async (_ctx: CommandContext, projectId: string) => listDelegations(projectId),
  delegationGrant: async (ctx: CommandContext, input: { projectId: string; capability: string; limits?: Record<string, unknown>; expiresAt?: string }) => { assertHuman(ctx, 'Granting an operation delegation'); projectExists(input.projectId); if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) throw new Error('Delegation expiration must be in the future'); const limits = input.limits ?? {}, t = now(), id = randomUUID(); sqlite.transaction(() => { run("UPDATE operation_delegations SET status='revoked',revoked_at=? WHERE project_id=? AND capability=? AND status='active'", t, input.projectId, input.capability); run('INSERT INTO operation_delegations(id,project_id,capability,status,limits_json,version_hash,approved_by,approved_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,?)', id, input.projectId, input.capability, 'active', JSON.stringify(limits), fingerprint({ capability: input.capability, limits, expiresAt: input.expiresAt ?? null }), ctx.actorId ?? 'human', t, input.expiresAt ?? null, null); }).immediate(); return listDelegations(input.projectId).find(item => item.id === id); },
  delegationRevoke: async (ctx: CommandContext, input: { projectId: string; delegationId: string; reason?: string }) => { assertHuman(ctx, 'Revoking an operation delegation'); projectExists(input.projectId); const t = now(), result = run("UPDATE operation_delegations SET status='revoked',revoked_at=? WHERE id=? AND project_id=? AND status='active'", t, input.delegationId, input.projectId); if (!result.changes) throw new Error('Active delegation not found'); if (input.reason) emitEvent({ projectId: input.projectId, kind: 'delegation_revoked', key: `delegation:${input.delegationId}:revoked`, payload: { reason: normalizeText(input.reason) } }); return { id: input.delegationId, status: 'revoked', revokedAt: t }; },

  executorRegister: async (ctx: CommandContext, input: { executorId?: string; capabilities?: string[]; leaseSeconds?: number }) => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('Executor registration requires an agent or system actor'); const executorId = input.executorId?.trim() || ctx.actorId?.trim(); required(executorId, 'Executor ID is required'); const t = now(), expires = leaseUntil(input.leaseSeconds), existing = one('SELECT * FROM operation_executors WHERE id=?', executorId), generation = Number(existing?.generation ?? 0) + 1;
    if (existing?.current_operation_id && existing?.current_project_id) await operationCommands.recordRuntime(ctx, { executorId, generation: Number(existing.generation), operationId: existing.current_operation_id, projectId: existing.current_project_id });
    run(`INSERT INTO operation_executors(id,kind,status,capabilities_json,current_operation_id,current_project_id,generation,last_seen_at,lease_expires_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=CASE WHEN operation_executors.cooldown_until>? THEN 'cooldown' ELSE 'online' END,capabilities_json=excluded.capabilities_json,current_operation_id=NULL,current_project_id=NULL,generation=excluded.generation,last_seen_at=excluded.last_seen_at,lease_expires_at=excluded.lease_expires_at,updated_at=excluded.updated_at`, executorId, 'agent', 'online', JSON.stringify(input.capabilities ?? []), null, null, generation, t, expires, existing?.created_at ?? t, t, t); return executorView(one('SELECT * FROM operation_executors WHERE id=?', executorId));
  },
  executorHeartbeat: async (ctx: CommandContext, input: { executorId?: string; generation: number; leaseSeconds?: number }) => { if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('Executor heartbeat requires an agent or system actor'); const executorId = input.executorId?.trim() || ctx.actorId?.trim(); required(executorId, 'Executor ID is required'); const t = now(), expires = leaseUntil(input.leaseSeconds); const result = run("UPDATE operation_executors SET status=CASE WHEN cooldown_until>? THEN 'cooldown' WHEN current_operation_id IS NOT NULL THEN 'busy' ELSE 'online' END,last_seen_at=?,lease_expires_at=?,updated_at=? WHERE id=? AND generation=?", t, t, expires, t, executorId, input.generation); if (!result.changes) throw new Error('Executor generation changed; register again before continuing'); return executorView(one('SELECT * FROM operation_executors WHERE id=?', executorId)); },
  executorClaim: async (ctx: CommandContext, input: { executorId?: string; generation: number; operationId: string; projectId: string; leaseSeconds?: number }) => { assertOperationAllowed(ctx, { projectId: input.projectId, command: 'operation.executor_claim', capability: 'operation.start' }); const executorId = input.executorId?.trim() || ctx.actorId?.trim(); required(executorId, 'Executor ID is required'); required(one('SELECT 1 FROM operation_projects WHERE operation_id=? AND project_id=?', input.operationId, input.projectId), 'Operation project not found'); const health = headlessCommands.executorHealth(executorId); if (!health?.runnable) throw new Error(`Executor is ${health?.status ?? 'unavailable'}`); const t = now(), expires = leaseUntil(input.leaseSeconds); const result = run(`UPDATE operation_executors SET current_operation_id=?,current_project_id=?,status='busy',last_seen_at=?,lease_expires_at=?,updated_at=? WHERE id=? AND generation=? AND (cooldown_until IS NULL OR cooldown_until<=?) AND status!='unavailable' AND (current_operation_id IS NULL OR lease_expires_at IS NULL OR lease_expires_at<=? OR (current_operation_id=? AND current_project_id=?))`, input.operationId, input.projectId, t, expires, t, executorId, input.generation, t, t, input.operationId, input.projectId); if (!result.changes) throw new Error('Executor cannot claim this operation; ownership, health or generation changed'); run("UPDATE operation_projects SET status='running',blocker=NULL,runtime_started_at=COALESCE(runtime_started_at,?),updated_at=? WHERE operation_id=? AND project_id=?", t, t, input.operationId, input.projectId); return executorView(one('SELECT * FROM operation_executors WHERE id=?', executorId)); },
  executorRelease: async (ctx: CommandContext, input: { executorId?: string; generation: number; operationId: string; projectId: string }) => { if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('Executor release requires an agent or system actor'); const executorId = input.executorId?.trim() || ctx.actorId?.trim(); required(executorId, 'Executor ID is required'); await operationCommands.recordRuntime(ctx, { ...input, executorId }); const t = now(); const result = run("UPDATE operation_executors SET current_operation_id=NULL,current_project_id=NULL,status=CASE WHEN cooldown_until>? THEN 'cooldown' ELSE 'online' END,last_seen_at=?,lease_expires_at=NULL,updated_at=? WHERE id=? AND generation=? AND current_operation_id=? AND current_project_id=?", t, t, t, executorId, input.generation, input.operationId, input.projectId); if (!result.changes) throw new Error('Executor release rejected because ownership changed'); return executorView(one('SELECT * FROM operation_executors WHERE id=?', executorId)); },

  acknowledgeEvent: async (ctx: CommandContext, input: { eventId: string }) => { assertHuman(ctx, 'Acknowledging an operation event'); const result = run('UPDATE operation_events SET acknowledged_at=? WHERE id=?', now(), input.eventId); if (!result.changes) throw new Error('Operation event not found'); return { id: input.eventId, acknowledgedAt: now() }; },
  remoteReadiness: async (_ctx: CommandContext) => ({ generatedAt: now(), database: { path: getDatabase().path, remoteSafe: process.env.KEYWORDS_REMOTE_DB_READY === '1', note: process.env.KEYWORDS_REMOTE_DB_READY === '1' ? 'Remote persistence explicitly marked ready.' : 'Local SQLite is the default; do not run multiple remote writers without a managed persistence decision.' }, api: { bindHost: process.env.KEYWORDS_API_HOST ?? '127.0.0.1', humanTokenConfigured: Boolean(process.env.KEYWORDS_API_HUMAN_TOKEN), agentTokenConfigured: Boolean(process.env.KEYWORDS_API_AGENT_TOKEN), allowedOriginsConfigured: Boolean(process.env.KEYWORDS_ALLOWED_ORIGINS) }, executor: { persistentRequested: process.env.KEYWORDS_EXECUTOR_PERSISTENT === '1', maxRetryAttempts: Math.max(1, Number(process.env.KEYWORDS_EXECUTOR_MAX_RETRIES ?? 5)) }, recommendation: process.env.KEYWORDS_REMOTE_DB_READY === '1' && process.env.KEYWORDS_API_AGENT_TOKEN ? 'remote_host_eligible' : 'keep_local_executor' })
};
