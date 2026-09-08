import { randomUUID } from 'node:crypto';
import { getDatabase } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { assertOperationAllowed } from './guard.js';
import { operationCommands } from './operation.js';

const { sqlite } = getDatabase();
const now = () => new Date().toISOString();
const one = (sql: string, ...args: any[]): any => sqlite.prepare(sql).get(...args);
const run = (sql: string, ...args: any[]) => sqlite.prepare(sql).run(...args);
function required(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const leaseUntil = (seconds?: number) => new Date(Date.now() + Math.max(60, Math.min(Math.floor(seconds ?? 300), 3600)) * 1000).toISOString();

export const operationDiscoveryCommands = {
  startAndClaim: async (ctx: CommandContext, input: {
    operationId: string; projectId: string; seedKeywords?: string[]; targetUrl?: string; goal: string; language?: string; country?: string; region?: string;
    excludedTerms?: string[]; maxCandidates?: number; maxExternalRequests?: number; leaseSeconds?: number;
  }) => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') return operationCommands.startDiscovery(ctx, input);
    assertOperationAllowed(ctx, { projectId: input.projectId, command: 'discovery.start', capability: 'discovery.start' });
    const started = await operationCommands.startDiscovery(ctx, input);
    const child = one('SELECT * FROM operation_projects WHERE operation_id=? AND project_id=?', input.operationId, input.projectId); required(child?.work_session_id, 'Operation work session is required before agent discovery');
    const job = one('SELECT * FROM discovery_jobs WHERE id=? AND project_id=?', started.jobId, input.projectId); required(job, 'Discovery job not found');
    if (job.status === 'running') {
      if (job.executor_id && job.executor_id !== ctx.actorId && ctx.actor !== 'system') throw new Error('Discovery job is already owned by another executor');
      return { ...started, status: 'running', executorId: job.executor_id, workSessionId: job.work_session_id ?? child.work_session_id, leaseExpiresAt: job.lease_expires_at };
    }
    if (job.status !== 'waiting_for_agent') throw new Error(`Discovery job cannot be claimed from ${job.status}`);
    const executorId = ctx.actorId ?? 'system'; const t = now(); const expires = leaseUntil(input.leaseSeconds);
    const updated = run(`UPDATE discovery_jobs SET status='running',work_session_id=?,executor_id=?,heartbeat_at=?,lease_expires_at=?,started_at=COALESCE(started_at,?),error=NULL,updated_at=?
      WHERE id=? AND project_id=? AND status='waiting_for_agent'`, child.work_session_id, executorId, t, expires, t, t, job.id, input.projectId);
    if (!updated.changes) throw new Error('Discovery claim lost a concurrent race');
    if (job.task_id) run("UPDATE tasks SET status='doing',updated_at=? WHERE id=?", t, job.task_id);
    run('INSERT INTO runs(id,project_id,work_session_id,actor,actor_id,command,status,input_json,output_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', randomUUID(), input.projectId, child.work_session_id, ctx.actor, ctx.actorId ?? null, 'operation.discovery_claim', 'succeeded', JSON.stringify({ operationId: input.operationId, jobId: job.id }), JSON.stringify({ executorId, leaseExpiresAt: expires }), t);
    return { ...started, status: 'running', executorId, workSessionId: child.work_session_id, leaseExpiresAt: expires };
  }
};
