import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDatabase } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { assertOperationAllowed, operationControl } from './guard.js';

const { sqlite } = getDatabase();
const now = () => new Date().toISOString();
const one = (sql: string, ...args: any[]): any => sqlite.prepare(sql).get(...args);
const rows = (sql: string, ...args: any[]): any[] => sqlite.prepare(sql).all(...args);
const run = (sql: string, ...args: any[]) => sqlite.prepare(sql).run(...args);
const parse = <T>(value: string | null | undefined, fallback: T): T => { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
const hashText = (value: string) => createHash('sha256').update(value).digest('hex');
const hashJson = (value: unknown) => hashText(JSON.stringify(value));
const VALIDATOR_VERSION = 'article-validator-v1';
const AUTO_RESUME_BLOCKERS = new Set(['quality_revision_required', 'artifact_missing']);

function ensureColumn(table: string, name: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function ensureHeadlessSchema() {
  sqlite.exec(`
CREATE TABLE IF NOT EXISTS operation_artifacts (
 id TEXT PRIMARY KEY,
 operation_id TEXT NOT NULL REFERENCES operation_requests(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
 article_id TEXT NOT NULL,
 artifact_path TEXT NOT NULL,
 content_sha256 TEXT NOT NULL,
 source_ids_json TEXT NOT NULL,
 validator_version TEXT,
 validator_status TEXT NOT NULL DEFAULT 'pending',
 validator_result_hash TEXT,
 validator_result_json TEXT,
 build_command TEXT,
 build_status TEXT NOT NULL DEFAULT 'pending',
 build_result_hash TEXT,
 before_hash TEXT,
 after_hash TEXT NOT NULL,
 manifest_json TEXT NOT NULL,
 revision_key TEXT,
 revision_count INTEGER NOT NULL DEFAULT 0,
 validation_attempts INTEGER NOT NULL DEFAULT 0,
 no_progress_count INTEGER NOT NULL DEFAULT 0,
 generated_at TEXT NOT NULL,
 verified_at TEXT,
 updated_at TEXT NOT NULL,
 UNIQUE(operation_id, project_id, article_id)
);
CREATE INDEX IF NOT EXISTS operation_artifacts_project_status_idx ON operation_artifacts(project_id, validator_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS operation_artifacts_page_idx ON operation_artifacts(project_id, page_id, updated_at DESC);
`);
  ensureColumn('operation_projects', 'blocker_class', 'blocker_class TEXT');
  ensureColumn('operation_projects', 'last_progress_at', 'last_progress_at TEXT');
  ensureColumn('operation_projects', 'runtime_consumed_ms', 'runtime_consumed_ms INTEGER NOT NULL DEFAULT 0');
  ensureColumn('operation_executors', 'failure_class', 'failure_class TEXT');
  ensureColumn('operation_executors', 'failure_count', 'failure_count INTEGER NOT NULL DEFAULT 0');
  ensureColumn('operation_executors', 'cooldown_until', 'cooldown_until TEXT');
  ensureColumn('operation_executors', 'last_error', 'last_error TEXT');
  ensureColumn('operation_executors', 'last_failure_at', 'last_failure_at TEXT');
  ensureColumn('autopilot_state', 'tick_lease_owner', 'tick_lease_owner TEXT');
  ensureColumn('autopilot_state', 'tick_lease_expires_at', 'tick_lease_expires_at TEXT');
  ensureColumn('autopilot_state', 'last_tick_started_at', 'last_tick_started_at TEXT');
  ensureColumn('autopilot_state', 'last_tick_finished_at', 'last_tick_finished_at TEXT');
  sqlite.exec(`
CREATE TRIGGER IF NOT EXISTS autonomous_handoff_requires_verified_artifact
BEFORE INSERT ON blog_handoffs
WHEN COALESCE(json_extract(NEW.payload_json, '$.publication_authorized'), 0) = 1
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM operation_artifacts a
    WHERE a.project_id=NEW.project_id AND a.page_id=NEW.page_id
      AND a.validator_status='passed' AND a.build_status='passed' AND a.verified_at IS NOT NULL
  ) THEN RAISE(ABORT, 'Autonomous publication requires a verified local article artifact') END;
END;
`);
}
ensureHeadlessSchema();

function artifactRoot() {
  const configured = process.env.KEYWORDS_BLOG_ROOT?.trim() || process.env.KEYWORDS_ARTIFACT_ROOT?.trim();
  if (!configured) throw new Error('KEYWORDS_BLOG_ROOT is required for article file writes and validation');
  return resolve(configured);
}

function safeArtifactPath(ref: string) {
  const clean = ref.trim().replaceAll('\\', '/').replace(/^\.\//, '');
  if (!clean || isAbsolute(clean) || clean.includes(':') || clean.split('/').some(part => part === '..' || part === '.')) throw new Error('Artifact path must be a safe relative path');
  const root = artifactRoot();
  const absolute = resolve(root, clean);
  const rel = relative(root, absolute);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Artifact path escapes KEYWORDS_BLOG_ROOT');
  return { root, ref: clean, absolute };
}

function pageSourceIds(projectId: string, pageId: string) {
  const brief = one('SELECT packet_json FROM blog_briefs WHERE project_id=? AND page_id=?', projectId, pageId);
  const packet = parse<any>(brief?.packet_json, {});
  const ids = new Set<string>();
  for (const id of packet.value_source_ids ?? []) ids.add(String(id));
  for (const id of packet.demand_source_ids ?? []) ids.add(String(id));
  for (const item of packet.claim_source_map ?? []) if (item?.source_id) ids.add(String(item.source_id));
  const autonomy = packet.autonomy ?? {};
  for (const list of Object.values(autonomy.source_packet ?? {}) as unknown[]) if (Array.isArray(list)) for (const id of list) ids.add(String(id));
  for (const item of autonomy.fact_ledger ?? []) if (item?.source_id) ids.add(String(item.source_id));
  if (!ids.size) {
    for (const row of rows("SELECT source_id FROM source_links WHERE project_id=? AND target_type='page' AND target_id=?", projectId, pageId)) ids.add(String(row.source_id));
  }
  return [...ids];
}

function validateSources(projectId: string, sourceIds: string[]) {
  const unique = [...new Set(sourceIds.filter(Boolean))];
  for (const id of unique) if (!one('SELECT id FROM sources WHERE id=? AND project_id=?', id, projectId)) throw new Error(`Source ${id} does not belong to project ${projectId}`);
  return unique;
}

function defaultArtifactRef(projectId: string, page: any) {
  if (page.plan_mode === 'existing_page_improvement' && page.target_page_id) {
    const target = one('SELECT url FROM pages WHERE id=? AND project_id=?', page.target_page_id, projectId);
    const binding = one('SELECT snapshot_json FROM blog_bindings WHERE project_id=?', projectId);
    const snapshot = parse<any>(binding?.snapshot_json, {});
    const match = (snapshot.sources ?? []).find((item: any) => item.expected_url === target?.url);
    if (match?.source_ref) return String(match.source_ref);
  }
  const configuredDir = (process.env.KEYWORDS_BLOG_ARTICLE_DIR ?? 'content').replace(/^\/+|\/+$/g, '');
  const extension = process.env.KEYWORDS_BLOG_ARTICLE_EXTENSION?.trim() || '.md';
  return `${configuredDir}/${String(page.slug).replace(/^\/+|\/+$/g, '')}${extension.startsWith('.') ? extension : `.${extension}`}`;
}

function recordRun(ctx: CommandContext, projectId: string, command: string, input: unknown, output: unknown, error?: unknown) {
  run('INSERT INTO runs(id,project_id,work_session_id,actor,actor_id,command,status,input_json,output_json,error,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    randomUUID(), projectId, ctx.workSessionId ?? null, ctx.actor, ctx.actorId ?? null, command, error ? 'failed' : 'succeeded', JSON.stringify(input ?? null), error ? null : JSON.stringify(output ?? null), error ? String(error instanceof Error ? error.message : error).slice(0, 1000) : null, now());
}

function reserveArtifactAction(ctx: CommandContext, projectId: string) {
  if (!ctx.workSessionId) return;
  const session = one('SELECT * FROM work_sessions WHERE id=? AND project_id=?', ctx.workSessionId, projectId);
  if (!session) throw new Error('Artifact command work session is not in project');
  if (session.status !== 'running') throw new Error(`Work session is ${session.status}`);
  const used = Number(one("SELECT COUNT(*) AS n FROM runs WHERE work_session_id=? AND status IN ('succeeded','failed')", session.id)?.n ?? 0);
  if (used >= Number(session.max_actions)) throw new Error('Work session action budget exhausted');
}

function atomicWrite(absolute: string, content: string) {
  mkdirSync(dirname(absolute), { recursive: true });
  const temp = `${absolute}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(temp, 'w');
    writeFileSync(fd, content, { encoding: 'utf8' });
    fsyncSync(fd);
    closeSync(fd); fd = null;
    renameSync(temp, absolute);
  } catch (error) {
    if (fd !== null) try { closeSync(fd); } catch {}
    try { if (existsSync(temp)) unlinkSync(temp); } catch {}
    throw error;
  }
}

function artifactView(row: any) {
  if (!row) return null;
  return {
    id: row.id, operationId: row.operation_id, projectId: row.project_id, pageId: row.page_id, articleId: row.article_id,
    path: row.artifact_path, contentSha256: row.content_sha256, sourceIds: parse(row.source_ids_json, []), validatorVersion: row.validator_version,
    validatorStatus: row.validator_status, validatorResultHash: row.validator_result_hash, validatorResult: parse(row.validator_result_json, null),
    buildCommand: row.build_command, buildStatus: row.build_status, buildResultHash: row.build_result_hash, beforeHash: row.before_hash, afterHash: row.after_hash,
    revisionKey: row.revision_key, revisionCount: Number(row.revision_count ?? 0), validationAttempts: Number(row.validation_attempts ?? 0), noProgressCount: Number(row.no_progress_count ?? 0),
    generatedAt: row.generated_at, verifiedAt: row.verified_at, updatedAt: row.updated_at, manifest: parse(row.manifest_json, {})
  };
}

function normalizeMatch(value: string) { return value.toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, ''); }
function grams(value: string) {
  const n = normalizeMatch(value); const set = new Set<string>();
  for (let i = 0; i < Math.max(0, n.length - 1); i++) set.add(n.slice(i, i + 2));
  return set;
}
function similarity(a: string, b: string) {
  const na = normalizeMatch(a), nb = normalizeMatch(b); if (!na || !nb) return 0; if (na.includes(nb) || nb.includes(na)) return 1;
  const ga = grams(a), gb = grams(b); if (!ga.size || !gb.size) return 0;
  let hit = 0; for (const g of gb) if (ga.has(g)) hit++;
  return hit / gb.size;
}
function numericTokens(value: string) { return value.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []; }
function sourceText(row: any) {
  const meta = parse<any>(row?.metadata_json, {});
  return String(meta?.document?.text ?? meta?.document?.excerpt ?? meta?.result?.text ?? meta?.excerpt ?? JSON.stringify(meta ?? {}));
}
function markdownLinks(content: string) { return [...content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1].trim()); }

function buildManifest(row: any, extra: Record<string, unknown> = {}) {
  return {
    schema_version: 1, operation_id: row.operation_id, project_id: row.project_id, article_id: row.article_id, page_id: row.page_id,
    artifact_path: row.artifact_path, content_sha256: row.content_sha256, source_ids: parse(row.source_ids_json, []),
    validator: { version: row.validator_version, status: row.validator_status, result_hash: row.validator_result_hash },
    build: { command: row.build_command, status: row.build_status, result_hash: row.build_result_hash },
    before_hash: row.before_hash, after_hash: row.after_hash, generated_at: row.generated_at, verified_at: row.verified_at, ...extra
  };
}

function contentOperationRequired(op: any, child: any) {
  const constraints = parse<Record<string, unknown>>(op.constraints_json, {});
  if (constraints.requiresArtifact === true) return true;
  if (one('SELECT id FROM operation_artifacts WHERE operation_id=? AND project_id=? LIMIT 1', op.id, child.project_id)) return true;
  if (!child.work_session_id) return false;
  return Boolean(one("SELECT id FROM runs WHERE work_session_id=? AND command IN ('page.plan','blog.prepare','artifact.write_draft','artifact.validate') LIMIT 1", child.work_session_id));
}

function completionStatus(operationId: string) {
  const op = one('SELECT * FROM operation_requests WHERE id=?', operationId); if (!op) throw new Error('Operation not found');
  const children = rows('SELECT * FROM operation_projects WHERE operation_id=?', operationId);
  const projects = children.map(child => {
    const required = contentOperationRequired(op, child);
    const artifact = one('SELECT * FROM operation_artifacts WHERE operation_id=? AND project_id=? ORDER BY updated_at DESC LIMIT 1', operationId, child.project_id);
    let fileMatches = false;
    if (artifact) {
      try { const p = safeArtifactPath(artifact.artifact_path); fileMatches = existsSync(p.absolute) && hashText(readFileSync(p.absolute, 'utf8')) === artifact.content_sha256; } catch { fileMatches = false; }
    }
    const complete = !required || Boolean(artifact && fileMatches && artifact.validator_status === 'passed' && artifact.build_status === 'passed' && artifact.verified_at && parse(artifact.source_ids_json, []).length);
    return { projectId: child.project_id, required, complete, blockerClass: child.blocker_class ?? null, fileMatches, artifact: artifactView(artifact) };
  });
  return { operationId, required: projects.some(item => item.required), complete: projects.every(item => item.complete), projects };
}

function ensureHumanBoundary(operationId: string, projectId: string, artifact: any, reason: string) {
  const child = one('SELECT * FROM operation_projects WHERE operation_id=? AND project_id=?', operationId, projectId); if (!child) return;
  const existing = one("SELECT id FROM review_requests WHERE project_id=? AND work_session_id IS ? AND target_type='operation_artifact' AND target_id=? AND status='open' LIMIT 1", projectId, child.work_session_id ?? null, artifact.id);
  if (!existing) run('INSERT INTO review_requests(id,project_id,work_session_id,target_type,target_id,title,question,options_json,status,requested_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    randomUUID(), projectId, child.work_session_id ?? null, 'operation_artifact', artifact.id, 'Article revision needs human decision', reason, JSON.stringify(['review_failed_checks','stop_article']), 'open', 'headless-validator', now());
  if (child.work_session_id) run("UPDATE work_sessions SET status='awaiting_review',summary=?,last_next_action='await_human_decision',updated_at=? WHERE id=?", reason.slice(0, 2000), now(), child.work_session_id);
  run("UPDATE operation_projects SET status='awaiting_review',blocker=?,blocker_class='human_decision_required',updated_at=? WHERE operation_id=? AND project_id=?", reason.slice(0, 2000), now(), operationId, projectId);
  run("UPDATE operation_requests SET status='awaiting_review',updated_at=? WHERE id=?", now(), operationId);
}

export const headlessCommands = {
  ensureSchema: async () => ({ ok: true }),

  dueProjects: async () => rows(`SELECT c.project_id
    FROM autopilot_controls c
    LEFT JOIN autopilot_state s ON s.project_id=c.project_id
    LEFT JOIN operation_controls oc ON oc.project_id=c.project_id
    WHERE c.enabled=1 AND COALESCE(oc.paused,0)=0
      AND (s.next_tick_at IS NULL OR s.next_tick_at<=?)
      AND (s.tick_lease_expires_at IS NULL OR s.tick_lease_expires_at<=?)
      AND EXISTS (SELECT 1 FROM operation_executors e WHERE (e.cooldown_until IS NULL OR e.cooldown_until<=?) AND e.status!='unavailable')
    ORDER BY COALESCE(s.next_tick_at,'')`, now(), now(), now()).map(row => String(row.project_id)),

  runAutopilotTick: async (ctx: CommandContext, projectId: string, input: { force?: boolean; leaseSeconds?: number } = {}) => {
    const control = one('SELECT * FROM autopilot_controls WHERE project_id=?', projectId); if (!control?.enabled && !input.force) return { skipped: true, reason: 'disabled' };
    if (operationControl(projectId).paused) return { skipped: true, reason: 'paused' };
    const t = now(); const state = one('SELECT * FROM autopilot_state WHERE project_id=?', projectId);
    if (!input.force && state?.next_tick_at && state.next_tick_at > t) return { skipped: true, reason: 'not_due', nextTickAt: state.next_tick_at };
    run(`INSERT OR IGNORE INTO autopilot_state(project_id,status,stage,updated_at) VALUES(?,?,?,?)`, projectId, 'idle', 'idle', t);
    const owner = `${ctx.actorId ?? ctx.actor}:${process.pid}:${randomUUID()}`;
    const expires = new Date(Date.now() + Math.max(30, Math.min(Number(input.leaseSeconds ?? 120), 900)) * 1000).toISOString();
    const claimed = run(`UPDATE autopilot_state SET tick_lease_owner=?,tick_lease_expires_at=?,last_tick_started_at=?,updated_at=?
      WHERE project_id=? AND (tick_lease_expires_at IS NULL OR tick_lease_expires_at<=?)`, owner, expires, t, t, projectId, t);
    if (!claimed.changes) return { skipped: true, reason: 'tick_locked', leaseExpiresAt: one('SELECT tick_lease_expires_at FROM autopilot_state WHERE project_id=?', projectId)?.tick_lease_expires_at ?? null };
    try {
      const { autopilotCommands } = await import('./autopilot.js');
      return await autopilotCommands.tick(ctx, projectId);
    } finally {
      run('UPDATE autopilot_state SET tick_lease_owner=NULL,tick_lease_expires_at=NULL,last_tick_finished_at=?,updated_at=? WHERE project_id=? AND tick_lease_owner=?', now(), now(), projectId, owner);
    }
  },

  classifyExecutorFailure: (value: unknown) => {
    const text = String(value instanceof Error ? `${value.name}: ${value.message}` : value ?? '').toLowerCase();
    if (/enoent|not found|cannot find.*executable|spawn .* failed/.test(text)) return 'executable_missing';
    if (/rate.?limit|too many requests|\b429\b|quota|usage limit|capacity limit/.test(text)) return 'provider_rate_limit';
    if (/unauthori[sz]ed|forbidden|invalid api.?key|authentication|\b401\b|\b403\b/.test(text)) return 'executor_authentication';
    if (/mcp.*(fail|error)|bootstrap.*(fail|error)|failed to start.*mcp/.test(text)) return 'mcp_bootstrap';
    if (/node.*version|runtime.*version|unsupported engine|version mismatch/.test(text)) return 'runtime_mismatch';
    if (/service unavailable|provider unavailable|provider outage|\b503\b|\b502\b/.test(text)) return 'provider_unavailable';
    if (/network.*(unreachable|failed)|econnreset|etimedout|temporary failure/.test(text)) return 'executor_network';
    return null;
  },

  recordExecutorFailure: async (input: { executorId: string; generation?: number; failureClass: string; message: string; retryAfterSeconds?: number }) => {
    const row = one('SELECT * FROM operation_executors WHERE id=?', input.executorId); if (!row) throw new Error('Executor not registered');
    if (input.generation !== undefined && Number(row.generation) !== Number(input.generation)) throw new Error('Executor generation changed');
    const count = Number(row.failure_count ?? 0) + 1;
    const base = input.failureClass === 'provider_rate_limit' ? 900 : input.failureClass === 'executor_authentication' ? 1800 : 120;
    const seconds = Math.max(60, Math.min(Number(input.retryAfterSeconds ?? base * 2 ** Math.min(count - 1, 4)), 21_600));
    const until = new Date(Date.now() + seconds * 1000).toISOString();
    run("UPDATE operation_executors SET status='cooldown',failure_class=?,failure_count=?,cooldown_until=?,last_error=?,last_failure_at=?,updated_at=? WHERE id=?", input.failureClass, count, until, input.message.slice(0, 1000), now(), now(), input.executorId);
    return headlessCommands.executorHealth(input.executorId);
  },

  executorHealth: (executorId: string) => {
    const row = one('SELECT * FROM operation_executors WHERE id=?', executorId); if (!row) return null;
    const cooling = Boolean(row.cooldown_until && row.cooldown_until > now());
    const effectiveStatus = cooling ? 'cooldown' : row.status === 'unavailable' ? 'unavailable' : row.current_operation_id ? 'busy' : (row.status === 'offline' ? 'offline' : 'online');
    return { id: row.id, status: effectiveStatus, runnable: !cooling && row.status !== 'unavailable' && row.status !== 'offline', failureClass: row.failure_class ?? null, failureCount: Number(row.failure_count ?? 0), cooldownUntil: row.cooldown_until ?? null, lastError: row.last_error ?? null, lastFailureAt: row.last_failure_at ?? null, currentOperationId: row.current_operation_id ?? null, currentProjectId: row.current_project_id ?? null, lastSeenAt: row.last_seen_at };
  },

  clearExecutorFailureIfDue: async (executorId: string) => {
    const row = one('SELECT * FROM operation_executors WHERE id=?', executorId); if (!row) throw new Error('Executor not registered');
    if (row.cooldown_until && row.cooldown_until > now()) return headlessCommands.executorHealth(executorId);
    if (row.status === 'cooldown') run("UPDATE operation_executors SET status=CASE WHEN current_operation_id IS NULL THEN 'online' ELSE 'busy' END,cooldown_until=NULL,updated_at=? WHERE id=?", now(), executorId);
    return headlessCommands.executorHealth(executorId);
  },

  writeDraft: async (ctx: CommandContext, input: { operationId: string; projectId: string; pageId: string; content: string; artifactPath?: string; articleId?: string; sourceIds?: string[]; buildCommand?: string }) => {
    assertOperationAllowed(ctx, { projectId: input.projectId, command: 'artifact.write_draft', capability: 'blog.prepare' });
    reserveArtifactAction(ctx, input.projectId);
    const child = one('SELECT * FROM operation_projects WHERE operation_id=? AND project_id=?', input.operationId, input.projectId); if (!child) throw new Error('Project is not part of this operation');
    const page = one('SELECT * FROM pages WHERE id=? AND project_id=?', input.pageId, input.projectId); if (!page) throw new Error('Page not found in project');
    const content = input.content; if (!content?.trim()) throw new Error('Article content is required');
    const ref = input.artifactPath?.trim() || defaultArtifactRef(input.projectId, page);
    const path = safeArtifactPath(ref);
    const beforeHash = existsSync(path.absolute) ? hashText(readFileSync(path.absolute, 'utf8')) : null;
    atomicWrite(path.absolute, content);
    const persisted = readFileSync(path.absolute, 'utf8');
    const afterHash = hashText(persisted); if (persisted !== content) throw new Error('Atomic article write verification failed');
    const sourceIds = validateSources(input.projectId, input.sourceIds?.length ? input.sourceIds : pageSourceIds(input.projectId, input.pageId));
    const articleId = input.articleId?.trim() || input.pageId;
    const old = one('SELECT * FROM operation_artifacts WHERE operation_id=? AND project_id=? AND article_id=?', input.operationId, input.projectId, articleId);
    const revisionCount = old && old.content_sha256 !== afterHash ? Number(old.revision_count ?? 0) + 1 : Number(old?.revision_count ?? 0);
    const id = old?.id ?? randomUUID(); const t = now();
    const provisional = { operation_id: input.operationId, project_id: input.projectId, page_id: input.pageId, article_id: articleId, artifact_path: path.ref, content_sha256: afterHash, source_ids_json: JSON.stringify(sourceIds), validator_version: VALIDATOR_VERSION, validator_status: 'pending', validator_result_hash: null, build_command: input.buildCommand?.trim() || old?.build_command || process.env.KEYWORDS_BLOG_BUILD_COMMAND?.trim() || null, build_status: 'pending', build_result_hash: null, before_hash: beforeHash, after_hash: afterHash, generated_at: t, verified_at: null };
    const manifest = buildManifest(provisional);
    run(`INSERT INTO operation_artifacts(id,operation_id,project_id,page_id,article_id,artifact_path,content_sha256,source_ids_json,validator_version,validator_status,validator_result_hash,validator_result_json,build_command,build_status,build_result_hash,before_hash,after_hash,manifest_json,revision_key,revision_count,validation_attempts,no_progress_count,generated_at,verified_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(operation_id,project_id,article_id) DO UPDATE SET page_id=excluded.page_id,artifact_path=excluded.artifact_path,content_sha256=excluded.content_sha256,source_ids_json=excluded.source_ids_json,validator_version=excluded.validator_version,validator_status='pending',validator_result_hash=NULL,validator_result_json=NULL,build_command=excluded.build_command,build_status='pending',build_result_hash=NULL,before_hash=excluded.before_hash,after_hash=excluded.after_hash,manifest_json=excluded.manifest_json,revision_key=NULL,revision_count=excluded.revision_count,no_progress_count=CASE WHEN operation_artifacts.content_sha256=excluded.content_sha256 THEN operation_artifacts.no_progress_count ELSE 0 END,generated_at=excluded.generated_at,verified_at=NULL,updated_at=excluded.updated_at`,
      id,input.operationId,input.projectId,input.pageId,articleId,path.ref,afterHash,JSON.stringify(sourceIds),VALIDATOR_VERSION,'pending',null,null,provisional.build_command,'pending',null,beforeHash,afterHash,JSON.stringify(manifest),null,revisionCount,Number(old?.validation_attempts ?? 0),old?.content_sha256===afterHash?Number(old?.no_progress_count??0):0,t,null,t);
    run("UPDATE operation_projects SET last_progress_at=?,blocker=NULL,blocker_class=NULL,updated_at=? WHERE operation_id=? AND project_id=?", t, t, input.operationId, input.projectId);
    const result = artifactView(one('SELECT * FROM operation_artifacts WHERE id=?', id)); recordRun(ctx, input.projectId, 'artifact.write_draft', { operationId: input.operationId, pageId: input.pageId, artifactPath: path.ref, sourceIds }, { artifactId: id, contentSha256: afterHash });
    return result;
  },

  validateDraft: async (ctx: CommandContext, input: { operationId: string; projectId: string; articleId?: string; buildCommand?: string; force?: boolean }) => {
    assertOperationAllowed(ctx, { projectId: input.projectId, command: 'artifact.validate', capability: 'blog.prepare', allowWhilePaused: true });
    reserveArtifactAction(ctx, input.projectId);
    const articleId = input.articleId?.trim();
    const artifact = articleId ? one('SELECT * FROM operation_artifacts WHERE operation_id=? AND project_id=? AND article_id=?', input.operationId, input.projectId, articleId) : one('SELECT * FROM operation_artifacts WHERE operation_id=? AND project_id=? ORDER BY updated_at DESC LIMIT 1', input.operationId, input.projectId);
    if (!artifact) throw new Error('No article artifact has been written for this operation');
    const path = safeArtifactPath(artifact.artifact_path); const exists = existsSync(path.absolute); const content = exists ? readFileSync(path.absolute, 'utf8') : '';
    const page = artifact.page_id ? one('SELECT * FROM pages WHERE id=? AND project_id=?', artifact.page_id, input.projectId) : null;
    const briefRow = artifact.page_id ? one('SELECT packet_json,packet_hash FROM blog_briefs WHERE project_id=? AND page_id=?', input.projectId, artifact.page_id) : null;
    const brief = parse<any>(briefRow?.packet_json, {}); const sourceIds = validateSources(input.projectId, parse<string[]>(artifact.source_ids_json, []));
    const buildCommand = input.buildCommand?.trim() || artifact.build_command || process.env.KEYWORDS_BLOG_BUILD_COMMAND?.trim() || '';
    const revisionKey = hashJson({ contentSha256: exists ? hashText(content) : null, packetHash: briefRow?.packet_hash ?? null, validatorVersion: VALIDATOR_VERSION, buildCommand });
    if (!input.force && artifact.revision_key === revisionKey && artifact.validator_result_json) return { cached: true, ...artifactView(artifact) };
    const checks: Array<{ key: string; ok: boolean; detail?: unknown }> = [];
    const actualHash = exists ? hashText(content) : null;
    checks.push({ key: 'file_exists', ok: exists });
    checks.push({ key: 'non_empty', ok: content.trim().length >= 80, detail: content.trim().length });
    checks.push({ key: 'content_hash', ok: actualHash === artifact.content_sha256, detail: actualHash });
    const ext = extname(path.ref).toLowerCase();
    const frontmatterRequired = ['.md','.mdx'].includes(ext);
    checks.push({ key: 'frontmatter', ok: !frontmatterRequired || /^---\s*\n[\s\S]*?\n---\s*\n/.test(content) });
    checks.push({ key: 'page_identity', ok: Boolean(page && page.project_id === input.projectId && (!page.title || similarity(content, page.title) >= 0.15)) });
    const facts = brief?.autonomy?.fact_ledger ?? [];
    const factResults = facts.map((fact: any) => {
      const source = one('SELECT * FROM sources WHERE id=? AND project_id=?', fact.source_id, input.projectId); const sText = sourceText(source);
      const articleScore = similarity(content, String(fact.claim ?? '')); const sourceScore = similarity(sText, String(fact.claim ?? ''));
      const nums = numericTokens(String(fact.claim ?? '')); const numbersSupported = nums.every(n => normalizeMatch(sText).includes(normalizeMatch(n)));
      return { claim: fact.claim, sourceId: fact.source_id, articleScore, sourceScore, numbersSupported, ok: articleScore >= 0.12 && sourceScore >= 0.06 && numbersSupported };
    });
    checks.push({ key: 'source_backed_claims', ok: facts.length > 0 && factResults.every((item: any) => item.ok), detail: factResults });
    const question = String(page?.question ?? brief?.reader_task ?? ''); checks.push({ key: 'reader_question_coverage', ok: !question || similarity(content, question) >= 0.08, detail: question });
    let maxDuplicate = 0;
    for (const other of rows("SELECT * FROM operation_artifacts WHERE project_id=? AND id<>? AND validator_status='passed' ORDER BY updated_at DESC LIMIT 20", input.projectId, artifact.id)) {
      try { const otherPath = safeArtifactPath(other.artifact_path); if (existsSync(otherPath.absolute)) maxDuplicate = Math.max(maxDuplicate, similarity(content, readFileSync(otherPath.absolute, 'utf8'))); } catch {}
    }
    checks.push({ key: 'duplicate_content', ok: maxDuplicate < 0.88, detail: maxDuplicate });
    const firstParty = (brief?.autonomy?.source_packet?.first_party_source_ids ?? []).length > 0;
    const fabricationPattern = /\b(i|we)\s+(tested|used|measured|interviewed|surveyed)\b|実際に(?:使|試|測|検証)|(?:私|当社|弊社)が(?:検証|測定|調査)/i;
    checks.push({ key: 'fabrication_pattern', ok: firstParty || !fabricationPattern.test(content) });
    const links = markdownLinks(content); const badLinks = links.filter(link => { try { if (/^(javascript|data):/i.test(link)) return true; if (/^https?:/i.test(link)) new URL(link); return false; } catch { return true; } });
    checks.push({ key: 'link_syntax', ok: badLinks.length === 0, detail: badLinks });
    let buildStatus = 'failed', buildResultHash: string | null = null, buildDetail: unknown = 'No build command configured';
    if (buildCommand) {
      const built = spawnSync(buildCommand, { cwd: path.root, shell: true, encoding: 'utf8', timeout: Math.max(10_000, Math.min(Number(process.env.KEYWORDS_BUILD_TIMEOUT_MS ?? 180_000), 600_000)), maxBuffer: 2_000_000, env: process.env });
      buildStatus = built.status === 0 && !built.error ? 'passed' : 'failed';
      buildResultHash = hashJson({ status: built.status, signal: built.signal, error: built.error?.message ?? null, stdout: (built.stdout ?? '').slice(-20_000), stderr: (built.stderr ?? '').slice(-20_000) });
      buildDetail = { status: built.status, signal: built.signal, error: built.error?.message ?? null };
    }
    checks.push({ key: 'site_build', ok: buildStatus === 'passed', detail: buildDetail });
    const passed = checks.every(check => check.ok); const result = { validatorVersion: VALIDATOR_VERSION, status: passed ? 'passed' : 'failed', revisionKey, contentSha256: actualHash, checks, failedChecks: checks.filter(check => !check.ok).map(check => check.key), validatedAt: now() };
    const resultHash = hashJson(result); const attempts = Number(artifact.validation_attempts ?? 0) + 1; const maxRevisions = Math.max(1, Number(process.env.KEYWORDS_MAX_ARTICLE_REVISIONS ?? 3));
    const verifiedAt = passed ? now() : null;
    const next = { ...artifact, validator_version: VALIDATOR_VERSION, validator_status: result.status, validator_result_hash: resultHash, validator_result_json: JSON.stringify(result), build_command: buildCommand || null, build_status: buildStatus, build_result_hash: buildResultHash, revision_key: revisionKey, validation_attempts: attempts, verified_at: verifiedAt };
    const manifest = buildManifest(next, { validation_attempts: attempts, revision_count: Number(artifact.revision_count ?? 0) });
    run('UPDATE operation_artifacts SET validator_version=?,validator_status=?,validator_result_hash=?,validator_result_json=?,build_command=?,build_status=?,build_result_hash=?,revision_key=?,validation_attempts=?,verified_at=?,manifest_json=?,updated_at=? WHERE id=?', VALIDATOR_VERSION,result.status,resultHash,JSON.stringify(result),buildCommand||null,buildStatus,buildResultHash,revisionKey,attempts,verifiedAt,JSON.stringify(manifest),now(),artifact.id);
    if (passed) run("UPDATE operation_projects SET last_progress_at=?,blocker=NULL,blocker_class=NULL,updated_at=? WHERE operation_id=? AND project_id=?", now(), now(), input.operationId, input.projectId);
    else if (Number(artifact.revision_count ?? 0) >= maxRevisions) ensureHumanBoundary(input.operationId, input.projectId, artifact, `Article validation failed after ${artifact.revision_count} revisions: ${result.failedChecks.join(', ')}`);
    const view = artifactView(one('SELECT * FROM operation_artifacts WHERE id=?', artifact.id)); recordRun(ctx, input.projectId, 'artifact.validate', { operationId: input.operationId, articleId: artifact.article_id, revisionKey }, { status: result.status, resultHash, cached: false });
    return { cached: false, ...view };
  },

  context: async (input: { operationId?: string; projectId?: string; pageId?: string }) => {
    if (input.operationId) return rows('SELECT * FROM operation_artifacts WHERE operation_id=? ORDER BY updated_at DESC', input.operationId).map(artifactView);
    if (input.pageId && input.projectId) return rows('SELECT * FROM operation_artifacts WHERE project_id=? AND page_id=? ORDER BY updated_at DESC', input.projectId, input.pageId).map(artifactView);
    if (input.projectId) return rows('SELECT * FROM operation_artifacts WHERE project_id=? ORDER BY updated_at DESC LIMIT 100', input.projectId).map(artifactView);
    return rows('SELECT * FROM operation_artifacts ORDER BY updated_at DESC LIMIT 100').map(artifactView);
  },

  completionStatus: async (operationId: string) => completionStatus(operationId),
  assertCompletion: (operationId: string) => { const status = completionStatus(operationId); if (!status.complete) { const missing = status.projects.filter(item => !item.complete).map(item => `${item.projectId}:${item.artifact ? `${item.artifact.validatorStatus}/${item.artifact.buildStatus}` : 'artifact_missing'}`); throw new Error(`Operation cannot complete until required article artifacts are verified: ${missing.join(', ')}`); } return status; },
  canAutoResumeBlocker: (blockerClass?: string | null) => Boolean(blockerClass && AUTO_RESUME_BLOCKERS.has(blockerClass)),

  resumeEligibleOperations: async () => {
    const eligible = rows(`SELECT op.*,o.status AS operation_status FROM operation_projects op JOIN operation_requests o ON o.id=op.operation_id
      LEFT JOIN operation_controls c ON c.project_id=op.project_id
      WHERE op.status='blocked' AND op.blocker_class IN ('quality_revision_required','artifact_missing') AND COALESCE(c.paused,0)=0`);
    let resumed = 0;
    for (const child of eligible) {
      const openReview = child.work_session_id ? one("SELECT id FROM review_requests WHERE work_session_id=? AND status='open' LIMIT 1", child.work_session_id) : null; if (openReview) continue;
      const artifact = one('SELECT * FROM operation_artifacts WHERE operation_id=? AND project_id=? ORDER BY updated_at DESC LIMIT 1', child.operation_id, child.project_id);
      const maxNoProgress = Math.max(1, Number(process.env.KEYWORDS_MAX_NO_PROGRESS_RETRIES ?? 2));
      if (artifact && Number(artifact.no_progress_count ?? 0) >= maxNoProgress) { ensureHumanBoundary(child.operation_id, child.project_id, artifact, 'Article execution made no artifact progress across repeated retries.'); continue; }
      if (child.work_session_id) run("UPDATE work_sessions SET status='running',last_next_action='resume_article_revision',updated_at=? WHERE id=?", now(), child.work_session_id);
      run("UPDATE operation_projects SET status='running',blocker=NULL,updated_at=? WHERE operation_id=? AND project_id=?", now(), child.operation_id, child.project_id);
      run("UPDATE operation_requests SET status='active',updated_at=? WHERE id=?", now(), child.operation_id); resumed++;
    }
    return { resumed };
  },

  noteIncomplete: async (operationId: string, projectId: string, blockerClass: 'quality_revision_required'|'artifact_missing', summary: string) => {
    const artifact = one('SELECT * FROM operation_artifacts WHERE operation_id=? AND project_id=? ORDER BY updated_at DESC LIMIT 1', operationId, projectId);
    if (artifact) run('UPDATE operation_artifacts SET no_progress_count=no_progress_count+1,updated_at=? WHERE id=?', now(), artifact.id);
    const child = one('SELECT * FROM operation_projects WHERE operation_id=? AND project_id=?', operationId, projectId); if (!child) throw new Error('Operation project not found');
    if (child.work_session_id) run("UPDATE work_sessions SET status='blocked',summary=?,last_next_action='resume_article_revision',updated_at=? WHERE id=?", summary.slice(0, 2000), now(), child.work_session_id);
    run("UPDATE operation_projects SET status='blocked',blocker=?,blocker_class=?,updated_at=? WHERE operation_id=? AND project_id=?", summary.slice(0, 2000), blockerClass, now(), operationId, projectId);
    run("UPDATE operation_requests SET status='blocked',updated_at=? WHERE id=?", now(), operationId);
    return completionStatus(operationId);
  },

  dashboard: async () => {
    const artifacts = rows(`SELECT a.*,p.title,p.slug,p.status AS page_status,pr.name AS project_name
      FROM operation_artifacts a LEFT JOIN pages p ON p.id=a.page_id JOIN projects pr ON pr.id=a.project_id ORDER BY a.updated_at DESC LIMIT 100`).map(row => ({ ...artifactView(row), title: row.title ?? row.article_id, slug: row.slug ?? null, pageStatus: row.page_status ?? null, projectName: row.project_name }));
    const attention = rows(`SELECT op.operation_id,op.project_id,op.status,op.blocker,op.blocker_class,op.updated_at,p.name AS project_name,o.objective
      FROM operation_projects op JOIN projects p ON p.id=op.project_id JOIN operation_requests o ON o.id=op.operation_id
      WHERE op.status IN ('blocked','awaiting_review') ORDER BY op.updated_at DESC LIMIT 50`).map(row => ({ operationId: row.operation_id, projectId: row.project_id, projectName: row.project_name, status: row.status, blocker: row.blocker, blockerClass: row.blocker_class, objective: row.objective, updatedAt: row.updated_at }));
    const executors = rows('SELECT id FROM operation_executors ORDER BY last_seen_at DESC').map(row => headlessCommands.executorHealth(String(row.id)));
    const complete = artifacts.filter((item: any) => item.validatorStatus === 'passed' && item.buildStatus === 'passed' && item.verifiedAt);
    const inProgress = artifacts.filter((item: any) => !(item.validatorStatus === 'passed' && item.buildStatus === 'passed' && item.verifiedAt));
    return { generatedAt: now(), complete, inProgress, attention, executors };
  }
};
