import { randomUUID } from 'node:crypto';
import { getDatabase } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { activeDelegation, assertOperationAllowed } from './guard.js';
import { autonomyAllows } from './autonomy.js';
import { headlessCommands } from './headless.js';
import { isBudgetedCommand } from './budget.js';

const { sqlite } = getDatabase();
const now = () => new Date().toISOString();
const one = (sql: string, ...args: any[]): any => sqlite.prepare(sql).get(...args);
const rows = (sql: string, ...args: any[]): any[] => sqlite.prepare(sql).all(...args);
const run = (sql: string, ...args: any[]) => sqlite.prepare(sql).run(...args);
function required(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const leaseUntil = (seconds?: number) => new Date(Date.now() + Math.max(60, Math.min(Math.floor(seconds ?? 300), 3600)) * 1000).toISOString();

function executor(id: string) { return one('SELECT * FROM operation_executors WHERE id=?', id); }
function view(row: any) {
  if (!row) return null;
  const health = headlessCommands.executorHealth(String(row.id));
  return {
    id: row.id,
    status: health?.status ?? row.status,
    runnable: health?.runnable ?? false,
    capabilities: JSON.parse(row.capabilities_json || '[]'),
    generation: Number(row.generation),
    currentOperationId: row.current_operation_id,
    currentProjectId: row.current_project_id,
    lastSeenAt: row.last_seen_at,
    leaseExpiresAt: row.lease_expires_at,
    failureClass: health?.failureClass ?? null,
    failureCount: health?.failureCount ?? 0,
    cooldownUntil: health?.cooldownUntil ?? null,
    lastError: health?.lastError ?? null
  };
}

function candidate(ctx: CommandContext, projectId?: string, operatorKinds?: string[], boundOnly = false) {
  const params: any[] = [now(), now()];
  let projectFilter = '';
  if (projectId) { projectFilter = ' AND op.project_id=?'; params.push(projectId); }
  if (boundOnly) projectFilter += ' AND EXISTS(SELECT 1 FROM blog_bindings binding WHERE binding.project_id=op.project_id)';
  if (operatorKinds) {
    if (!operatorKinds.length) return undefined;
    projectFilter += ` AND json_extract(o.constraints_json,'$.operatorKind') IN (${operatorKinds.map(() => '?').join(',')})`;
    params.push(...operatorKinds);
  }
  return rows(`SELECT op.*,o.objective,o.created_at AS operation_created_at,o.status AS operation_status,t.priority AS task_priority
    FROM operation_projects op
    JOIN operation_requests o ON o.id=op.operation_id
    LEFT JOIN tasks t ON t.id=op.task_id
    LEFT JOIN operation_controls c ON c.project_id=op.project_id
    WHERE o.status='active' AND op.status IN ('queued','running')
      AND COALESCE(c.paused,0)=0
      AND (op.work_session_id IS NULL OR EXISTS (SELECT 1 FROM work_sessions ws WHERE ws.id=op.work_session_id AND ws.status='running'))
      AND NOT EXISTS (SELECT 1 FROM review_requests rr WHERE rr.project_id=op.project_id AND rr.status='open')
      AND NOT EXISTS (
        SELECT 1 FROM operation_executors e
        WHERE e.current_operation_id=op.operation_id AND e.current_project_id=op.project_id
          AND e.status='busy' AND e.lease_expires_at>?
      )
      AND NOT EXISTS (
        SELECT 1 FROM discovery_jobs dj
        WHERE dj.project_id=op.project_id AND dj.status='running' AND dj.lease_expires_at>?
      )
      ${projectFilter}
    ORDER BY CASE WHEN op.blocker_class IN ('quality_revision_required','artifact_missing') THEN 0 ELSE 1 END,
      COALESCE(t.priority,50) DESC,o.created_at ASC`, ...params).find(item =>
      ctx.actor === 'system' || autonomyAllows(item.project_id, 'operation.start') || activeDelegation(item.project_id, 'operation.start'));
}

export const executorCommands = {
  recoverLegacyMaintenance: async (ctx: CommandContext, input: { projectId?: string; boundOnly?: boolean } = {}) => {
    if (ctx.actor !== 'system' && ctx.actor !== 'agent') throw new Error('Maintenance recovery requires an executor');
    const candidates = rows(`SELECT child.*,o.constraints_json,ws.summary AS work_summary,ws.status AS work_status,ws.max_actions
      FROM operation_projects child JOIN operation_requests o ON o.id=child.operation_id JOIN work_sessions ws ON ws.id=child.work_session_id
      WHERE o.status='blocked' AND child.status='blocked' AND child.blocker_class IS NULL
        AND child.blocker='External agent process exited with code 1.'
        AND json_extract(o.constraints_json,'$.source')='autopilot'
        AND json_extract(o.constraints_json,'$.operatorKind') IN ('sync_site','capture_metrics','capture_recovery')`);
    const recovered: Array<{operationId:string;projectId:string}> = [];
    for (const item of candidates) {
      if (input.projectId && input.projectId !== item.project_id) continue;
      if (input.boundOnly && !one('SELECT 1 FROM blog_bindings WHERE project_id=?',item.project_id)) continue;
      if (item.work_status !== 'blocked' || item.work_summary !== item.blocker || !autonomyAllows(item.project_id,'operation.start')) continue;
      if (one("SELECT 1 FROM review_requests WHERE project_id=? AND status='open'",item.project_id) || one('SELECT 1 FROM operation_controls WHERE project_id=? AND paused=1',item.project_id)) continue;
      if (one("SELECT 1 FROM operation_executors WHERE current_project_id=? AND lease_expires_at>? AND status='busy'",item.project_id,now())) continue;
      const used=rows('SELECT command FROM runs WHERE work_session_id=?',item.work_session_id).filter(row=>isBudgetedCommand(row.command)).length;
      if (used >= Number(item.max_actions)) continue;
      assertOperationAllowed({...ctx,workSessionId:undefined},{projectId:item.project_id,command:'operation.recover_maintenance',capability:'operation.start'});
      const t=now(),summary='Recovered the legacy external-agent exit: this measurement task now executes shared deterministic commands without an external agent process.';
      sqlite.transaction(()=>{
        run("UPDATE work_sessions SET status='running',summary=?,last_next_action='Execute the existing measurement operation through shared commands.',updated_at=? WHERE id=?",summary,t,item.work_session_id);
        run('INSERT INTO work_checkpoints(id,session_id,state,summary,next_action,created_at) VALUES(?,?,?,?,?,?)',randomUUID(),item.work_session_id,'working',summary,'Execute the existing measurement operation through shared commands.',t);
        run("UPDATE operation_projects SET status='running',blocker=NULL,blocker_class=NULL,updated_at=? WHERE operation_id=? AND project_id=?",t,item.operation_id,item.project_id);
        run("UPDATE operation_requests SET status='active',updated_at=? WHERE id=?",t,item.operation_id);
        run('INSERT INTO runs(id,project_id,work_session_id,actor,actor_id,command,status,output_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)',randomUUID(),item.project_id,item.work_session_id,ctx.actor,ctx.actorId??null,'operation.recover_maintenance','succeeded',JSON.stringify({operationId:item.operation_id,previousBlocker:item.blocker,reason:summary}),t);
      }).immediate();
      recovered.push({operationId:item.operation_id,projectId:item.project_id});
    }
    return {recovered};
  },
  claimNext: async (ctx: CommandContext, input: { executorId?: string; generation: number; projectId?: string; leaseSeconds?: number; operatorKinds?: string[]; boundOnly?: boolean }) => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('Executor claim requires an agent or system actor');
    const executorId = input.executorId?.trim() || ctx.actorId?.trim(); required(executorId, 'Executor ID is required');
    const row = executor(executorId); required(row, 'Register executor before claiming work');
    if (Number(row.generation) !== Number(input.generation)) throw new Error('Executor generation changed; re-register before claiming');
    await headlessCommands.clearExecutorFailureIfDue(executorId);
    const health = headlessCommands.executorHealth(executorId);
    if (!health?.runnable) return { claimed: false, executor: view(executor(executorId)), reason: health?.status === 'cooldown' ? 'executor_cooldown' : 'executor_unavailable', retryAfter: health?.cooldownUntil ?? null };
    const item = candidate(ctx, input.projectId, input.operatorKinds, input.boundOnly); if (!item) return { claimed: false, executor: view(executor(executorId)), reason: 'no_eligible_operation' };
    assertOperationAllowed(ctx, { projectId: item.project_id, command: 'operation.executor_claim', capability: 'operation.start' });
    const expires = leaseUntil(input.leaseSeconds); const t = now();
    const result = sqlite.transaction(() => {
      const liveOther = one(`SELECT id FROM operation_executors WHERE id<>? AND current_operation_id=? AND current_project_id=? AND status='busy' AND lease_expires_at>? LIMIT 1`, executorId, item.operation_id, item.project_id, t);
      if (liveOther) throw new Error('Another executor already owns this operation project');
      const previousOwner = one('SELECT * FROM operation_executors WHERE current_operation_id=? AND current_project_id=? AND lease_expires_at<=? ORDER BY last_seen_at DESC LIMIT 1', item.operation_id, item.project_id, t);
      if (previousOwner && item.runtime_started_at) {
        const elapsed = Math.max(0, Date.parse(previousOwner.lease_expires_at) - Date.parse(item.runtime_started_at));
        run('UPDATE operation_projects SET runtime_consumed_ms=runtime_consumed_ms+?,runtime_started_at=NULL WHERE operation_id=? AND project_id=?', elapsed, item.operation_id, item.project_id);
        item.runtime_consumed_ms = Number(item.runtime_consumed_ms ?? 0) + elapsed;
        run('INSERT INTO runs(id,project_id,actor,actor_id,command,status,output_json,created_at) VALUES(?,?,?,?,?,?,?,?)', randomUUID(), item.project_id, ctx.actor, ctx.actorId ?? null, 'operation.runtime_recover', 'succeeded', JSON.stringify({operationId:item.operation_id,elapsedMs:elapsed}), t);
      }
      const claimed = run(`UPDATE operation_executors SET status='busy',current_operation_id=?,current_project_id=?,last_seen_at=?,lease_expires_at=?,updated_at=?
        WHERE id=? AND generation=? AND (cooldown_until IS NULL OR cooldown_until<=?) AND status!='unavailable'
          AND (current_operation_id IS NULL OR lease_expires_at IS NULL OR lease_expires_at<=? OR (current_operation_id=? AND current_project_id=?))`,
        item.operation_id, item.project_id, t, expires, t, executorId, input.generation, t, t, item.operation_id, item.project_id);
      if (!claimed.changes) throw new Error('Executor claim lost a generation/ownership/health race');
      if (item.work_session_id) {
        const session = one('SELECT * FROM work_sessions WHERE id=? AND project_id=?', item.work_session_id, item.project_id); required(session, 'Operation work session is missing');
        if (session.status === 'running') run('UPDATE work_sessions SET actor_id=?,updated_at=? WHERE id=?', executorId, t, session.id);
      }
      run("UPDATE operation_projects SET status='running',blocker=NULL,runtime_started_at=COALESCE(runtime_started_at,?),updated_at=? WHERE operation_id=? AND project_id=?", t, t, item.operation_id, item.project_id);
      run('INSERT OR IGNORE INTO operation_events(id,operation_id,project_id,kind,severity,dedupe_key,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)', randomUUID(), item.operation_id, item.project_id, 'executor_claimed', 'info', `executor:${executorId}:${input.generation}:${item.operation_id}:${item.project_id}`, JSON.stringify({ executorId, generation: input.generation, leaseExpiresAt: expires }), t);
      const operation = one('SELECT constraints_json,budget_json FROM operation_requests WHERE id=?', item.operation_id);
      const constraints = JSON.parse(operation.constraints_json || '{}'), budget = JSON.parse(operation.budget_json || '{}');
      const output = { claimed: true, operationId: item.operation_id, projectId: item.project_id, workSessionId: item.work_session_id, taskId: item.task_id, objective: item.objective, leaseExpiresAt: expires,
        instructions: typeof constraints.executionInstructions === 'string' ? constraints.executionInstructions : null,
        operatorKind: constraints.operatorKind ?? null,
        remainingRuntimeMs: Math.max(0, Number(budget.maxRuntimeMinutes ?? 30) * 60000 - Number(item.runtime_consumed_ms ?? 0)) };
      run('INSERT INTO runs(id,project_id,work_session_id,actor,actor_id,command,status,output_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)', randomUUID(), item.project_id, item.work_session_id ?? null, ctx.actor, ctx.actorId ?? null, 'operation.executor_claim', 'succeeded', JSON.stringify({ operationId: item.operation_id, executorId, generation: input.generation }), t);
      return output;
    }).immediate();
    return { ...result, executor: view(executor(executorId)) };
  },

  recoverStale: async (ctx: CommandContext, input: { before?: string }) => {
    if (ctx.actor !== 'system' && ctx.actor !== 'human') throw new Error('Stale executor recovery requires a system or human actor');
    const cutoff = input.before ?? now(); const stale = rows("SELECT * FROM operation_executors WHERE status IN ('online','busy') AND lease_expires_at IS NOT NULL AND lease_expires_at<=?", cutoff);
    const recovered: Array<Record<string, unknown>> = [];
    for (const row of stale) {
      sqlite.transaction(() => {
        if (row.current_operation_id && row.current_project_id) {
          const child = one('SELECT runtime_started_at FROM operation_projects WHERE operation_id=? AND project_id=?', row.current_operation_id, row.current_project_id);
          const elapsed = child?.runtime_started_at ? Math.max(0, Date.parse(row.lease_expires_at)-Date.parse(child.runtime_started_at)) : 0;
          run('UPDATE operation_projects SET runtime_consumed_ms=runtime_consumed_ms+?,runtime_started_at=NULL WHERE operation_id=? AND project_id=?', elapsed, row.current_operation_id, row.current_project_id);
          run('INSERT INTO runs(id,project_id,actor,actor_id,command,status,output_json,created_at) VALUES(?,?,?,?,?,?,?,?)', randomUUID(), row.current_project_id, ctx.actor, ctx.actorId ?? null, 'operation.executor_recover', 'succeeded', JSON.stringify({operationId:row.current_operation_id,executorId:row.id,elapsedMs:elapsed}), now());
          const jobs = rows("SELECT id,task_id FROM discovery_jobs WHERE project_id=? AND executor_id=? AND status='running' AND (lease_expires_at IS NULL OR lease_expires_at<=?)", row.current_project_id, row.id, cutoff);
          for (const job of jobs) {
            run("UPDATE discovery_jobs SET status='waiting_for_agent',executor_id=NULL,heartbeat_at=NULL,lease_expires_at=NULL,error=?,updated_at=? WHERE id=?", 'Executor lease expired and was recovered.', now(), job.id);
            if (job.task_id) run("UPDATE tasks SET status='todo',updated_at=? WHERE id=?", now(), job.task_id);
          }
          run('INSERT OR IGNORE INTO operation_events(id,operation_id,project_id,kind,severity,dedupe_key,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)', randomUUID(), row.current_operation_id, row.current_project_id, 'executor_recovered', 'warning', `executor:${row.id}:${row.generation}:recovered`, JSON.stringify({ executorId: row.id, generation: row.generation, expiredAt: row.lease_expires_at }), now());
        }
        run("UPDATE operation_executors SET status='offline',current_operation_id=NULL,current_project_id=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND generation=?", now(), row.id, row.generation);
      }).immediate();
      recovered.push({ executorId: row.id, generation: Number(row.generation), operationId: row.current_operation_id, projectId: row.current_project_id });
    }
    return { recovered: recovered.length, executors: recovered };
  },

  list: async (_ctx: CommandContext) => rows('SELECT * FROM operation_executors ORDER BY last_seen_at DESC').map(view)
};
