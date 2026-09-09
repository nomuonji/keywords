import { randomUUID } from 'node:crypto';
import { getDatabase } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { operatorCommands } from './operator.js';
import { operationCommands } from './operation.js';
import { reviewCommands } from './review.js';
import { autonomyControl, autonomyStatusRows, configureAutonomy, evaluateAutonomyGate, publicationCapacity } from './autonomy.js';
import { operationControl } from './guard.js';

const { sqlite } = getDatabase();
const now = () => new Date().toISOString();
const one = (sql: string, ...args: any[]): any => sqlite.prepare(sql).get(...args);
const rows = (sql: string, ...args: any[]): any[] => sqlite.prepare(sql).all(...args);
const run = (sql: string, ...args: any[]) => sqlite.prepare(sql).run(...args);
const parse = <T>(value: string | null | undefined, fallback: T): T => { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
const systemCtx = (projectId: string): CommandContext => ({ actor: 'system', actorId: 'autopilot', projectId });

function state(projectId: string) {
  const row = one('SELECT * FROM autopilot_state WHERE project_id=?', projectId);
  return row ? {
    status: row.status, stage: row.stage, operationId: row.operation_id, targetType: row.target_type, targetId: row.target_id,
    summary: row.summary, decision: parse(row.decision_json, null), lastTickAt: row.last_tick_at, nextTickAt: row.next_tick_at,
    lastError: row.last_error, updatedAt: row.updated_at
  } : { status: 'idle', stage: 'idle', operationId: null, targetType: null, targetId: null, summary: 'Autopilot has not run yet.', decision: null, lastTickAt: null, nextTickAt: null, lastError: null, updatedAt: null };
}

function writeState(projectId: string, input: { status: string; stage: string; operationId?: string | null; targetType?: string | null; targetId?: string | null; summary?: string | null; decision?: unknown; lastError?: string | null }) {
  const control = autonomyControl(projectId); const t = now();
  const nextTickAt = new Date(Date.now() + control.cadenceMinutes * 60_000).toISOString();
  run(`INSERT INTO autopilot_state(project_id,status,stage,operation_id,target_type,target_id,summary,decision_json,last_tick_at,next_tick_at,last_error,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(project_id) DO UPDATE SET status=excluded.status,stage=excluded.stage,operation_id=excluded.operation_id,target_type=excluded.target_type,target_id=excluded.target_id,summary=excluded.summary,decision_json=excluded.decision_json,last_tick_at=excluded.last_tick_at,next_tick_at=excluded.next_tick_at,last_error=excluded.last_error,updated_at=excluded.updated_at`,
    projectId, input.status, input.stage, input.operationId ?? null, input.targetType ?? null, input.targetId ?? null, input.summary ?? null, JSON.stringify(input.decision ?? null), t, nextTickAt, input.lastError ?? null, t);
  return state(projectId);
}

function emit(projectId: string, kind: string, payload: unknown, severity: 'info' | 'warning' | 'error' = 'info', operationId?: string | null, keySuffix?: string) {
  const key = `autopilot:${projectId}:${kind}:${keySuffix ?? new Date().toISOString().slice(0, 16)}`;
  run('INSERT OR IGNORE INTO operation_events(id,operation_id,project_id,kind,severity,dedupe_key,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)', randomUUID(), operationId ?? null, projectId, kind, severity, key, JSON.stringify(payload ?? null), now());
}

function qualityQueue(projectId: string) {
  return rows("SELECT id,title,plan_mode,updated_at FROM pages WHERE project_id=? AND source='workspace' AND status IN ('proposed','approved') ORDER BY updated_at DESC LIMIT 8", projectId).map(page => {
    let gate: ReturnType<typeof evaluateAutonomyGate> | null = null;
    try { gate = evaluateAutonomyGate(projectId, page.id); } catch { gate = null; }
    return { id: page.id, title: page.title, planMode: page.plan_mode, status: page.status, updatedAt: page.updated_at, gate };
  });
}

function pipeline(projectId: string) {
  const scalar = (sql: string, ...args: any[]) => Number(one(sql, ...args)?.n ?? 0);
  return {
    discovery: scalar("SELECT COUNT(*) AS n FROM discovery_jobs WHERE project_id=? AND status IN ('waiting_for_agent','running','awaiting_review')", projectId),
    research: scalar("SELECT COUNT(*) AS n FROM work_sessions WHERE project_id=? AND status='running'", projectId),
    gate: scalar("SELECT COUNT(*) AS n FROM review_requests WHERE project_id=? AND status='open' AND target_type='page'", projectId),
    ready: scalar("SELECT COUNT(*) AS n FROM pages p WHERE p.project_id=? AND p.status='approved' AND NOT EXISTS (SELECT 1 FROM blog_handoffs h WHERE h.page_id=p.id AND h.status NOT IN ('blocked','evaluated'))", projectId),
    delivery: scalar("SELECT COUNT(*) AS n FROM blog_handoffs WHERE project_id=? AND status IN ('exported','accepted','local_verified')", projectId),
    observing: scalar("SELECT COUNT(*) AS n FROM blog_handoffs WHERE project_id=? AND status IN ('published','observing')", projectId)
  };
}

export const autopilotCommands = {
  configure: async (ctx: CommandContext, input: Parameters<typeof configureAutonomy>[1]) => configureAutonomy(ctx, input),
  enabledProjects: async () => autonomyStatusRows(),

  status: async (_ctx: CommandContext, projectId: string) => {
    const project = one('SELECT id,name,domain,mode FROM projects WHERE id=?', projectId); if (!project) throw new Error('Project not found');
    const control = autonomyControl(projectId); const opControl = operationControl(projectId);
    const active = one("SELECT o.id FROM operation_requests o JOIN operation_projects op ON op.operation_id=o.id WHERE op.project_id=? AND o.status IN ('active','awaiting_review','blocked') ORDER BY o.updated_at DESC LIMIT 1", projectId);
    const executor = one('SELECT id,status,current_operation_id,current_project_id,generation,last_seen_at,lease_expires_at FROM operation_executors WHERE current_project_id=? OR status IN (\'online\',\'busy\') ORDER BY last_seen_at DESC LIMIT 1', projectId);
    const manualReviews = rows("SELECT id,title,target_type,created_at FROM review_requests WHERE project_id=? AND status='open' AND target_type!='page' ORDER BY created_at DESC LIMIT 10", projectId);
    const events = rows("SELECT id,kind,severity,payload_json,created_at FROM operation_events WHERE project_id=? ORDER BY created_at DESC LIMIT 20", projectId).map(row => ({ id: row.id, kind: row.kind, severity: row.severity, payload: parse(row.payload_json, {}), createdAt: row.created_at }));
    const recentRuns = rows("SELECT id,command,status,duration_ms,created_at,error FROM runs WHERE project_id=? ORDER BY created_at DESC LIMIT 20", projectId);
    return {
      generatedAt: now(), project, control, operationControl: opControl, state: state(projectId), pipeline: pipeline(projectId),
      activeOperation: active ? await operationCommands.context(systemCtx(projectId), { operationId: active.id }) : null,
      executor: executor ? { id: executor.id, status: executor.status, operationId: executor.current_operation_id, projectId: executor.current_project_id, generation: Number(executor.generation), lastSeenAt: executor.last_seen_at, leaseExpiresAt: executor.lease_expires_at, connected: Date.now() - Date.parse(executor.last_seen_at) < 10 * 60_000 } : null,
      manualReviews, qualityQueue: qualityQueue(projectId), recentEvents: events, recentRuns,
      publication: { newArticle: publicationCapacity(projectId, 'new_article'), update: publicationCapacity(projectId, 'substantial_revision') }
    };
  },

  tick: async (ctx: CommandContext, projectId: string) => {
    if (ctx.actor !== 'system' && ctx.actor !== 'human') throw new Error('Autopilot tick requires a system or human actor');
    const control = autonomyControl(projectId);
    if (!control.enabled) return writeState(projectId, { status: 'disabled', stage: 'disabled', summary: 'Autopilot is disabled.' });
    const paused = operationControl(projectId);
    if (paused.paused || process.env.KEYWORDS_PAUSED === '1' || process.env.KEYWORDS_AGENT_PAUSED === '1') return writeState(projectId, { status: 'paused', stage: 'paused', summary: paused.reason ?? 'Agent operations are paused.' });
    const autoCtx = systemCtx(projectId);
    try {
      writeState(projectId, { status: 'running', stage: 'quality_gate', summary: 'Checking pending page decisions.' });
      const pageReview = one("SELECT * FROM review_requests WHERE project_id=? AND status='open' AND target_type='page' AND target_id IS NOT NULL ORDER BY created_at LIMIT 1", projectId);
      if (pageReview && control.autoApprove) {
        const gate = evaluateAutonomyGate(projectId, pageReview.target_id);
        const resolution = gate.decision === 'publish' ? 'approved' : gate.decision === 'revise' ? 'needs_edit' : 'rejected';
        await reviewCommands.resolve(autoCtx, { projectId, reviewId: pageReview.id, resolution, reason: `Autopilot quality gate: ${gate.decision}; score=${gate.score}; evidence=${gate.evidenceScore}; commodity=${gate.commodityRisk}; informationGain=${gate.informationGain}` });
        emit(projectId, 'autopilot_gate_decision', { reviewId: pageReview.id, pageId: pageReview.target_id, resolution, gate }, gate.decision === 'reject' ? 'warning' : 'info', null, pageReview.id);
        const activeAfterReview = one("SELECT o.id FROM operation_requests o JOIN operation_projects op ON op.operation_id=o.id WHERE op.project_id=? AND o.status IN ('active','awaiting_review','blocked') ORDER BY o.updated_at DESC LIMIT 1", projectId);
        if (activeAfterReview) await operationCommands.resume(autoCtx, { operationId: activeAfterReview.id, projectId });
        return writeState(projectId, { status: 'running', stage: gate.decision === 'publish' ? 'approved' : 'revision', targetType: 'page', targetId: pageReview.target_id, operationId: activeAfterReview?.id ?? null, summary: `Quality gate ${gate.decision}: ${resolution}`, decision: gate });
      }

      const active = one("SELECT o.id,o.status FROM operation_requests o JOIN operation_projects op ON op.operation_id=o.id WHERE op.project_id=? AND o.status IN ('active','awaiting_review','blocked') ORDER BY o.updated_at DESC LIMIT 1", projectId);
      if (active) {
        const op = await operationCommands.context(autoCtx, { operationId: active.id });
        return writeState(projectId, { status: active.status === 'blocked' ? 'blocked' : 'running', stage: active.status === 'awaiting_review' ? 'decision_wait' : 'executing', operationId: active.id, summary: `Operation ${active.status}: ${op.objective}` });
      }

      const manualReview = one("SELECT id,title,target_type FROM review_requests WHERE project_id=? AND status='open' AND target_type!='page' ORDER BY created_at LIMIT 1", projectId);
      if (manualReview) return writeState(projectId, { status: 'attention', stage: 'manual_boundary', targetType: manualReview.target_type, targetId: manualReview.id, summary: `Non-content boundary is waiting: ${manualReview.title}` });

      writeState(projectId, { status: 'running', stage: 'planning', summary: 'Selecting the highest-value next operation.' });
      const operator = await operatorCommands.inspect(autoCtx, projectId); const next = operator.next as Record<string, unknown>; const kind = String(next.kind ?? 'no_action');
      if (['no_action','operation_paused','await_review'].includes(kind)) return writeState(projectId, { status: 'idle', stage: 'idle', summary: String(next.reason ?? 'No justified action right now.'), decision: next });

      const related = next.relatedId ? String(next.relatedId) : 'none';
      const recurring = ['capture_metrics','sync_site','discovery_due','observe_outcome','blog_observation_due'].includes(kind);
      const bucket = recurring ? new Date().toISOString().slice(0, 10) : related;
      const objective = `Autonomous SEO operation: ${String(next.title ?? kind)}. ${String(next.reason ?? '')} Build or refresh evidence before conclusions. For content plans, create a Source Packet and Fact Ledger, score evidence and commodity risk, record at least two concrete information-gain items, and complete the publication gate. Prefer useful updates and problem-solving pages over commodity volume. Never invent experience, numbers, reviews, quotes, or current facts. Do not delete pages, move URLs, change DNS, or activate policy rules.`;
      const started = await operationCommands.start(autoCtx, {
        requestText: objective, objective, projectIds: [projectId], requestKey: `autopilot:${projectId}:${kind}:${bucket}`, conversationRef: `autopilot:${projectId}`,
        completionCriteria: ['Produce one evidence-backed site improvement, content plan, measurement result, or explicit blocker.', 'Content plans must pass the deterministic autonomy quality gate before delivery.', 'Record a measurable next condition or complete the operation.'],
        constraints: { source: 'autopilot', operatorKind: kind, relatedType: next.relatedType ?? null, relatedId: next.relatedId ?? null, destructiveActions: false },
        permissions: { contentResearch: true, contentPlanning: true, contentDelivery: control.autoPublish, destructiveActions: false },
        budget: { maxActions: 40, maxExternalRequests: 25, maxCandidateWrites: 150, maxProjects: 1, maxRuntimeMinutes: 120 }
      });
      emit(projectId, 'autopilot_operation_started', { operationId: started.operation.id, operator: next }, 'info', started.operation.id, started.operation.id);
      return writeState(projectId, { status: 'running', stage: 'queued_for_agent', operationId: started.operation.id, summary: started.operation.objective, decision: next });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit(projectId, 'autopilot_error', { error: message }, 'error', null, new Date().toISOString().slice(0, 13));
      return writeState(projectId, { status: 'error', stage: 'error', summary: 'Autopilot tick failed.', lastError: message });
    }
  }
};
