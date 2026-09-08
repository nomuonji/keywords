import { createHash } from 'node:crypto';
import { getDatabase } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { isBudgetedCommand } from './budget.js';

const { sqlite } = getDatabase();
const now = () => new Date().toISOString();
const one = (sql: string, ...args: any[]): any => sqlite.prepare(sql).get(...args);
const rows = (sql: string, ...args: any[]): any[] => sqlite.prepare(sql).all(...args);
const run = (sql: string, ...args: any[]) => sqlite.prepare(sql).run(...args);
const required = (value: unknown, message: string): asserts value => { if (!value) throw new Error(message); };
const parse = <T>(value: string | null | undefined, fallback: T): T => { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };

export type DelegationCapability =
  | 'operation.start'
  | 'discovery.start'
  | 'candidate.triage'
  | 'measurement.capture'
  | 'site.sync'
  | 'blog.prepare'
  | 'blog.transport'
  | 'outcome.record';

export interface DelegationView {
  id: string;
  projectId: string;
  capability: string;
  limits: Record<string, unknown>;
  versionHash: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string | null;
}

export function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function assertHuman(ctx: CommandContext, action: string) {
  if (ctx.actor !== 'human') throw new Error(`${action} requires an authenticated human actor`);
}

export function assertAgentOrSystem(ctx: CommandContext, action: string) {
  if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error(`${action} requires an agent or system actor`);
}

export function projectExists(projectId: string) {
  const project = one('SELECT id,name,domain,mode,language,country,region FROM projects WHERE id=?', projectId);
  required(project, 'Project not found');
  return project;
}

export function operationControl(projectId: string) {
  const control = one('SELECT * FROM operation_controls WHERE project_id=?', projectId);
  return control ? { paused: Boolean(control.paused), reason: control.reason ?? null, updatedBy: control.updated_by, updatedAt: control.updated_at } : { paused: false, reason: null, updatedBy: null, updatedAt: null };
}

export function setOperationPause(ctx: CommandContext, input: { projectId: string; paused: boolean; reason?: string }) {
  assertHuman(ctx, 'Changing the operation pause state');
  projectExists(input.projectId);
  const t = now();
  run(`INSERT INTO operation_controls(project_id,paused,reason,updated_by,updated_at)
       VALUES(?,?,?,?,?)
       ON CONFLICT(project_id) DO UPDATE SET paused=excluded.paused,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    input.projectId, input.paused ? 1 : 0, input.reason?.trim() || null, ctx.actorId ?? 'human', t);
  return operationControl(input.projectId);
}

export function activeDelegation(projectId: string, capability: string): DelegationView | null {
  const row = one(`SELECT * FROM operation_delegations
    WHERE project_id=? AND capability=? AND status='active'
      AND (expires_at IS NULL OR expires_at>?)
    ORDER BY approved_at DESC LIMIT 1`, projectId, capability, now());
  return row ? {
    id: row.id,
    projectId: row.project_id,
    capability: row.capability,
    limits: parse<Record<string, unknown>>(row.limits_json, {}),
    versionHash: row.version_hash,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    expiresAt: row.expires_at ?? null
  } : null;
}

export function assertDelegated(ctx: CommandContext, projectId: string, capability: DelegationCapability | string) {
  if (ctx.actor === 'human' || ctx.actor === 'system') return null;
  const delegation = activeDelegation(projectId, capability);
  if (!delegation) throw new Error(`Agent operation is not delegated: ${capability}`);
  return delegation;
}

export function assertSessionBudget(ctx: CommandContext, projectId: string, command: string) {
  if (!ctx.workSessionId) return;
  const session = one('SELECT * FROM work_sessions WHERE id=? AND project_id=?', ctx.workSessionId, projectId);
  required(session, 'Work session is not in this project');
  if (session.status !== 'running') throw new Error(`Work session ${session.id} is ${session.status}; writes and external research are paused`);
  if (ctx.actor === 'agent' && session.actor_id && session.actor_id !== ctx.actorId) throw new Error('Work session belongs to another agent');
  if (!isBudgetedCommand(command)) return;
  const commands = rows('SELECT command FROM runs WHERE work_session_id=?', session.id).map(row => String(row.command));
  const used = commands.filter(isBudgetedCommand).length;
  if (used >= Number(session.max_actions)) throw new Error(`Work session ${session.id} has exhausted its action budget`);
}

export function assertOperationAllowed(
  ctx: CommandContext,
  input: { projectId: string; command: string; capability?: DelegationCapability | string; allowWhilePaused?: boolean }
) {
  projectExists(input.projectId);
  const control = operationControl(input.projectId);
  const globallyPaused = process.env.KEYWORDS_PAUSED === '1' || process.env.KEYWORDS_AGENT_PAUSED === '1';
  if (ctx.actor !== 'human' && !input.allowWhilePaused && (globallyPaused || control.paused)) {
    const reason = control.reason ? `: ${control.reason}` : '';
    throw new Error(`Agent operations are paused${reason}`);
  }
  if (input.capability) assertDelegated(ctx, input.projectId, input.capability);
  assertSessionBudget(ctx, input.projectId, input.command);
}

export function listDelegations(projectId: string) {
  projectExists(projectId);
  return rows(`SELECT * FROM operation_delegations WHERE project_id=? ORDER BY approved_at DESC`, projectId).map(row => ({
    id: row.id,
    projectId: row.project_id,
    capability: row.capability,
    status: row.status,
    limits: parse<Record<string, unknown>>(row.limits_json, {}),
    versionHash: row.version_hash,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null
  }));
}
