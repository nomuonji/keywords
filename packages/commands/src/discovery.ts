import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CandidateStatus, CommandContext, DiscoveryJobStatus } from '@keywords/domain';
import { fetchWebDocument, googleAdsKeywordIdeas, searchSerp } from '@keywords/research';
import { workCommands } from './work.js';
import { recordProviderCapability } from './workspace.js';

const { db, sqlite } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const projectCtx = (ctx: CommandContext, projectId: string, workSessionId?: string): CommandContext => ({ ...ctx, projectId, workSessionId: workSessionId ?? ctx.workSessionId });
const parseStrings = (value: string | null) => { try { const parsed = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };
const parseJson = (value: string | null) => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
const redactError = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 1000);
const leaseMs = (seconds?: number) => Math.max(30, Math.min(Math.floor(seconds ?? 120), 600)) * 1000;
const leaseUntil = (seconds?: number) => new Date(Date.now() + leaseMs(seconds)).toISOString();

async function withRun<T>(ctx: CommandContext, command: string, input: unknown, fn: () => Promise<T>): Promise<T> {
  const runId = id(); const started = Date.now(); const createdAt = now();
  try {
    const output = await fn();
    await db.insert(schema.runs).values({ id: runId, projectId: ctx.projectId ?? null, workSessionId: ctx.workSessionId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null, command, status: 'succeeded', inputJson: JSON.stringify(input ?? null), outputJson: JSON.stringify(output ?? null), durationMs: Date.now() - started, createdAt });
    return output;
  } catch (error) {
    await db.insert(schema.runs).values({ id: runId, projectId: ctx.projectId ?? null, workSessionId: ctx.workSessionId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null, command, status: 'failed', inputJson: JSON.stringify(input ?? null), error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started, createdAt });
    throw error;
  }
}

async function requireProject(projectId: string) {
  const project = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!project) throw new Error('Project not found');
  return project;
}
async function requireJob(projectId: string, jobId: string) {
  const job = await db.select().from(schema.discoveryJobs).where(and(eq(schema.discoveryJobs.projectId, projectId), eq(schema.discoveryJobs.id, jobId))).get();
  if (!job) throw new Error('Discovery job not found');
  return job;
}
async function requireCandidate(projectId: string, jobId: string, candidateId: string) {
  const row = await db.select().from(schema.discoveryCandidates).where(and(eq(schema.discoveryCandidates.projectId, projectId), eq(schema.discoveryCandidates.jobId, jobId), eq(schema.discoveryCandidates.id, candidateId))).get();
  if (!row) throw new Error('Discovery candidate not found');
  return row;
}
function jobView(job: typeof schema.discoveryJobs.$inferSelect) {
  return {
    ...job,
    seedKeywords: parseStrings(job.seedKeywordsJson), excludedTerms: parseStrings(job.excludedTermsJson),
    leaseExpired: job.status === 'running' && (!job.leaseExpiresAt || Date.now() >= new Date(job.leaseExpiresAt).getTime()),
    seedKeywordsJson: undefined, excludedTermsJson: undefined
  };
}
function candidateView(row: typeof schema.discoveryCandidates.$inferSelect) {
  return { ...row, existingPageOverlap: parseJson(row.existingPageOverlapJson), unresolvedQuestions: parseStrings(row.unresolvedQuestionsJson), existingPageOverlapJson: undefined, unresolvedQuestionsJson: undefined };
}
function capabilityStatus(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP\s+429/.test(message)) return 'rate_limited' as const;
  if (/HTTP\s+(401|403)/.test(message)) return 'expired' as const;
  return 'failed' as const;
}
function requireExecutionLease(ctx: CommandContext, job: typeof schema.discoveryJobs.$inferSelect) {
  if (job.status !== 'running') throw new Error(`Discovery job is ${job.status}; agent work is not allowed`);
  if (ctx.actor === 'system') return;
  if (!ctx.actorId || !job.executorId || ctx.actorId !== job.executorId) throw new Error('Discovery job is owned by another executor');
  if (!job.leaseExpiresAt || Date.now() >= new Date(job.leaseExpiresAt).getTime()) throw new Error('Discovery executor lease expired; recover and reclaim the job before continuing');
}
function requestKey(prefix: string, payload: unknown, explicit?: string) {
  const key = explicit?.trim() || `${prefix}:${JSON.stringify(payload)}`;
  if (key.length > 1000) return `${prefix}:${key.slice(0, 980)}`;
  return key;
}
type Reservation = { id: string; project_id: string; job_id: string; provider: string; request_key: string; status: string; source_id: string | null; error: string | null; reserved_at: string; settled_at: string | null };
function reserveExternalRequest(ctx: CommandContext, job: typeof schema.discoveryJobs.$inferSelect, provider: string, key: string) {
  requireExecutionLease(ctx, job);
  const tx = sqlite.transaction(() => {
    const existing = sqlite.prepare('SELECT * FROM discovery_request_reservations WHERE job_id = ? AND request_key = ?').get(job.id, key) as Reservation | undefined;
    if (existing) return { reservation: existing, cached: existing.status === 'succeeded', created: false };
    const t = now();
    const updated = sqlite.prepare("UPDATE discovery_jobs SET external_requests_used = external_requests_used + 1, updated_at = ? WHERE id = ? AND project_id = ? AND status = 'running' AND external_requests_used < max_external_requests").run(t, job.id, job.projectId);
    if (updated.changes !== 1) throw new Error(`Discovery external request budget exhausted for job ${job.id}`);
    const row: Reservation = { id: id(), project_id: job.projectId, job_id: job.id, provider, request_key: key, status: 'reserved', source_id: null, error: null, reserved_at: t, settled_at: null };
    sqlite.prepare('INSERT INTO discovery_request_reservations (id, project_id, job_id, provider, request_key, status, source_id, error, reserved_at, settled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(row.id, row.project_id, row.job_id, row.provider, row.request_key, row.status, row.source_id, row.error, row.reserved_at, row.settled_at);
    return { reservation: row, cached: false, created: true };
  });
  const result = tx();
  if (result.created) return result;
  if (result.reservation.status === 'succeeded') return { ...result, cached: true };
  if (result.reservation.status === 'failed') throw new Error('This idempotency key already failed. Supply a new idempotencyKey to retry the external request.');
  if (result.reservation.status === 'reserved') throw new Error('This external request is already in progress for the same idempotency key.');
  throw new Error(`Unsupported request reservation status: ${result.reservation.status}`);
}
function settleReservation(reservationId: string, status: 'succeeded' | 'failed', sourceId?: string | null, error?: unknown) {
  const t = now();
  sqlite.prepare('UPDATE discovery_request_reservations SET status = ?, source_id = ?, error = ?, settled_at = ? WHERE id = ?').run(status, sourceId ?? null, status === 'failed' ? redactError(error) : null, t, reservationId);
  if (status === 'failed') sqlite.prepare('UPDATE discovery_jobs SET updated_at = ? WHERE id = (SELECT job_id FROM discovery_request_reservations WHERE id = ?)').run(t, reservationId);
}
async function cachedSource(sourceId: string | null) {
  if (!sourceId) return null;
  const source = await db.select().from(schema.sources).where(eq(schema.sources.id, sourceId)).get();
  return source ? { source, metadata: parseJson(source.metadataJson) as Record<string, any> | null } : null;
}
function reserveCandidateSlot(jobId: string) {
  const result = sqlite.prepare('UPDATE discovery_jobs SET candidate_writes_used = candidate_writes_used + 1, updated_at = ? WHERE id = ? AND candidate_writes_used < max_candidates').run(now(), jobId);
  return result.changes === 1;
}
function releaseCandidateSlot(jobId: string) {
  sqlite.prepare('UPDATE discovery_jobs SET candidate_writes_used = CASE WHEN candidate_writes_used > 0 THEN candidate_writes_used - 1 ELSE 0 END, updated_at = ? WHERE id = ?').run(now(), jobId);
}
async function upsertKeyword(projectId: string, input: { text: string; source: string; avgMonthly?: number | null; competition?: number | null; cpcMicros?: number | null }) {
  const normalized = normalize(input.text); if (!normalized) throw new Error('Keyword text is required');
  let existing = await db.select().from(schema.keywords).where(and(eq(schema.keywords.projectId, projectId), eq(schema.keywords.normalized, normalized))).get();
  const knownBefore = Boolean(existing);
  if (!existing) {
    const t = now();
    const row = { id: id(), projectId, topicId: null, text: input.text.trim(), normalized, source: input.source, status: 'active', avgMonthly: input.avgMonthly ?? null, competition: input.competition ?? null, cpcMicros: input.cpcMicros ?? null, gscClicks: null, gscImpressions: null, gscCtr: null, gscPosition: null, gscUpdatedAt: null, createdAt: t, updatedAt: t };
    await db.insert(schema.keywords).values(row).onConflictDoNothing();
    existing = await db.select().from(schema.keywords).where(and(eq(schema.keywords.projectId, projectId), eq(schema.keywords.normalized, normalized))).get();
  }
  if (!existing) throw new Error('Keyword upsert failed');
  await db.update(schema.keywords).set({ avgMonthly: input.avgMonthly ?? existing.avgMonthly, competition: input.competition ?? existing.competition, cpcMicros: input.cpcMicros ?? existing.cpcMicros, updatedAt: now() }).where(eq(schema.keywords.id, existing.id));
  return { id: existing.id, knownBefore };
}
async function overlapsForKeyword(projectId: string, keywordId: string) {
  return db.select({ id: schema.pages.id, title: schema.pages.title, url: schema.pages.url, status: schema.pages.status, role: schema.pageKeywords.role }).from(schema.pageKeywords).innerJoin(schema.pages, eq(schema.pageKeywords.pageId, schema.pages.id)).where(and(eq(schema.pages.projectId, projectId), eq(schema.pageKeywords.keywordId, keywordId), ne(schema.pages.status, 'archived')));
}
async function linkSource(projectId: string, sourceId: string, targetType: string, targetId: string, kind: string) {
  const existing = await db.select().from(schema.sourceLinks).where(and(eq(schema.sourceLinks.sourceId, sourceId), eq(schema.sourceLinks.targetType, targetType), eq(schema.sourceLinks.targetId, targetId), eq(schema.sourceLinks.kind, kind))).get();
  if (existing) return false;
  await db.insert(schema.sourceLinks).values({ id: id(), projectId, sourceId, targetType, targetId, kind, createdAt: now() }).onConflictDoNothing();
  return true;
}
async function recordOrigin(projectId: string, jobId: string, candidateId: string, keyword: string, knownBefore: boolean) {
  await db.insert(schema.decisions).values({ id: id(), projectId, actor: 'system', action: 'discovery.candidate_origin', targetType: 'discovery_candidate', targetId: candidateId, verdict: knownBefore ? 'already_known' : 'new', reason: null, metadataJson: JSON.stringify({ jobId, keyword }), createdAt: now() });
}
async function recordRuleReject(projectId: string, jobId: string, keyword: string, rule: string) {
  await db.insert(schema.decisions).values({ id: id(), projectId, actor: 'system', action: 'discovery.rule_reject', targetType: 'discovery_job', targetId: jobId, verdict: 'rejected', reason: rule, metadataJson: JSON.stringify({ keyword }), createdAt: now() });
}

async function importCandidateRows(ctx: CommandContext, job: typeof schema.discoveryJobs.$inferSelect, rows: Array<{ keyword: string; demandValue?: number | null; adCompetition?: number | null; demandProvider?: string | null; observedAt?: string | null; sourceId?: string | null }>) {
  requireExecutionLease(ctx, job);
  const excluded = parseStrings(job.excludedTermsJson).map(normalize);
  let created = 0; let updated = 0; let rejectedByRule = 0; let alreadyKnown = 0; let newlyDiscovered = 0; let capped = false;
  const candidateIds: string[] = [];
  for (const input of rows) {
    const normalized = normalize(input.keyword); if (!normalized) continue;
    const blockedBy = excluded.find(term => term && normalized.includes(term));
    if (blockedBy) { rejectedByRule++; await recordRuleReject(job.projectId, job.id, input.keyword.trim(), `Excluded term: ${blockedBy}`); continue; }
    let current = await db.select().from(schema.discoveryCandidates).where(and(eq(schema.discoveryCandidates.jobId, job.id), eq(schema.discoveryCandidates.normalized, normalized))).get();
    const keyword = await upsertKeyword(job.projectId, { text: input.keyword, source: input.demandProvider ?? 'discovery', avgMonthly: input.demandValue ?? null, competition: input.adCompetition ?? null });
    const overlap = await overlapsForKeyword(job.projectId, keyword.id); const t = now();
    if (current) {
      const linked = input.sourceId ? await linkSource(job.projectId, input.sourceId, 'discovery_candidate', current.id, 'demand') : false;
      await db.update(schema.discoveryCandidates).set({ keywordId: keyword.id, demandValue: input.demandValue ?? current.demandValue, demandProvider: input.demandProvider ?? current.demandProvider, demandObservedAt: input.observedAt ?? current.demandObservedAt, adCompetition: input.adCompetition ?? current.adCompetition, existingPageOverlapJson: JSON.stringify(overlap), evidenceCount: current.evidenceCount + (linked ? 1 : 0), updatedAt: t }).where(eq(schema.discoveryCandidates.id, current.id));
      candidateIds.push(current.id); updated++; continue;
    }
    if (!reserveCandidateSlot(job.id)) { capped = true; break; }
    const row = { id: id(), projectId: job.projectId, jobId: job.id, keywordId: keyword.id, keyword: input.keyword.trim(), normalized, status: 'discovered', demandValue: input.demandValue ?? null, demandProvider: input.demandProvider ?? null, demandObservedAt: input.observedAt ?? null, adCompetition: input.adCompetition ?? null, searchIntent: null, existingPageOverlapJson: JSON.stringify(overlap), serpStatus: 'not_researched', unresolvedQuestionsJson: null, evidenceCount: input.sourceId ? 1 : 0, language: job.language, country: job.country, region: job.region, createdAt: t, updatedAt: t };
    await db.insert(schema.discoveryCandidates).values(row).onConflictDoNothing();
    current = await db.select().from(schema.discoveryCandidates).where(and(eq(schema.discoveryCandidates.jobId, job.id), eq(schema.discoveryCandidates.normalized, normalized))).get();
    if (!current) { releaseCandidateSlot(job.id); throw new Error('Candidate insert failed'); }
    if (current.id !== row.id) { releaseCandidateSlot(job.id); updated++; }
    else {
      if (input.sourceId) await linkSource(job.projectId, input.sourceId, 'discovery_candidate', row.id, 'demand');
      await recordOrigin(job.projectId, job.id, row.id, row.keyword, keyword.knownBefore);
      if (keyword.knownBefore) alreadyKnown++; else newlyDiscovered++;
      created++;
    }
    candidateIds.push(current.id);
  }
  return { created, updated, candidateIds, capped, rejectedByRule, alreadyKnown, newlyDiscovered };
}

async function progressSummary(job: typeof schema.discoveryJobs.$inferSelect, candidates: Array<typeof schema.discoveryCandidates.$inferSelect>) {
  const origins = candidates.length ? await db.select().from(schema.decisions).where(and(eq(schema.decisions.projectId, job.projectId), eq(schema.decisions.action, 'discovery.candidate_origin'), inArray(schema.decisions.targetId, candidates.map(c => c.id)))) : [];
  const ruleRejects = await db.select().from(schema.decisions).where(and(eq(schema.decisions.projectId, job.projectId), eq(schema.decisions.action, 'discovery.rule_reject'), eq(schema.decisions.targetId, job.id)));
  const reservations = await db.select().from(schema.discoveryRequestReservations).where(eq(schema.discoveryRequestReservations.jobId, job.id)).orderBy(desc(schema.discoveryRequestReservations.reservedAt));
  return {
    newCandidates: origins.filter(row => row.verdict === 'new').length,
    alreadyKnown: origins.filter(row => row.verdict === 'already_known').length,
    rejectedByRule: ruleRejects.length,
    needsResearch: candidates.filter(c => c.status === 'research_more' || c.serpStatus === 'not_researched').length,
    failedObservations: reservations.filter(row => row.status === 'failed').length,
    requests: { used: job.externalRequestsUsed, limit: job.maxExternalRequests, succeeded: reservations.filter(r => r.status === 'succeeded').length, failed: reservations.filter(r => r.status === 'failed').length, inProgress: reservations.filter(r => r.status === 'reserved').length },
    candidateWrites: { used: job.candidateWritesUsed, limit: job.maxCandidates }
  };
}

async function reconcileJobAfterReview(projectId: string, jobId: string) {
  const job = await requireJob(projectId, jobId); const rows = await db.select().from(schema.discoveryCandidates).where(eq(schema.discoveryCandidates.jobId, jobId)); const t = now();
  if (rows.some(row => row.status === 'research_more')) {
    await db.update(schema.discoveryJobs).set({ status: 'waiting_for_agent', workSessionId: null, executorId: null, heartbeatAt: null, leaseExpiresAt: null, updatedAt: t }).where(eq(schema.discoveryJobs.id, jobId));
    if (job.taskId) await db.update(schema.tasks).set({ status: 'todo', updatedAt: t }).where(eq(schema.tasks.id, job.taskId));
    return 'waiting_for_agent';
  }
  if (rows.some(row => row.status === 'discovered')) return job.status === 'completed' ? 'completed' : 'awaiting_review';
  await db.update(schema.discoveryJobs).set({ status: 'completed', completedAt: t, executorId: null, heartbeatAt: null, leaseExpiresAt: null, updatedAt: t }).where(eq(schema.discoveryJobs.id, jobId));
  await db.update(schema.projects).set({ lastDiscoveryAt: t, updatedAt: t }).where(eq(schema.projects.id, projectId));
  if (job.taskId) await db.update(schema.tasks).set({ status: 'done', updatedAt: t }).where(eq(schema.tasks.id, job.taskId));
  return 'completed';
}

export const discoveryCommands = {
  list: async (ctx: CommandContext, projectId: string, limit = 30) => withRun(projectCtx(ctx, projectId), 'discovery.list', { projectId, limit }, async () => {
    const rows = await db.select().from(schema.discoveryJobs).where(eq(schema.discoveryJobs.projectId, projectId)).orderBy(desc(schema.discoveryJobs.createdAt)).limit(Math.max(1, Math.min(limit, 100)));
    const views = rows.map(job => ({ ...jobView(job), candidateCounts: Object.fromEntries(['discovered','shortlisted','hold','rejected','research_more','planned'].map(status => [status, 0])) }));
    for (const view of views) { const candidates = await db.select().from(schema.discoveryCandidates).where(eq(schema.discoveryCandidates.jobId, view.id)); for (const c of candidates) view.candidateCounts[c.status] = (view.candidateCounts[c.status] ?? 0) + 1; }
    return views;
  }),

  detail: async (ctx: CommandContext, input: { projectId: string; jobId: string }) => withRun(projectCtx(ctx, input.projectId), 'discovery.detail', input, async () => {
    const job = await requireJob(input.projectId, input.jobId);
    const candidates = await db.select().from(schema.discoveryCandidates).where(eq(schema.discoveryCandidates.jobId, job.id)).orderBy(desc(schema.discoveryCandidates.demandValue), schema.discoveryCandidates.keyword);
    return { job: jobView(job), candidates: candidates.map(candidateView), progress: await progressSummary(job, candidates) };
  }),

  start: async (ctx: CommandContext, input: { projectId: string; seedKeywords?: string[]; targetUrl?: string; goal: string; language?: string; country?: string; region?: string; excludedTerms?: string[]; maxCandidates?: number; maxExternalRequests?: number }) => withRun(projectCtx(ctx, input.projectId), 'discovery.start', input, async () => {
    if (ctx.actor !== 'human') throw new Error('Starting a discovery job requires a human actor');
    const project = await requireProject(input.projectId); const seeds = [...new Set((input.seedKeywords ?? []).map(x => x.trim()).filter(Boolean))]; const targetUrl = input.targetUrl?.trim() || null;
    if (!seeds.length && !targetUrl) throw new Error('At least one seed keyword or target URL is required'); const goal = input.goal.trim(); if (!goal) throw new Error('Discovery goal is required');
    const active = await db.select().from(schema.discoveryJobs).where(and(eq(schema.discoveryJobs.projectId, input.projectId), inArray(schema.discoveryJobs.status, ['waiting_for_agent','running','awaiting_review','blocked']))).orderBy(desc(schema.discoveryJobs.updatedAt)).get();
    if (active) throw new Error(`An unfinished discovery job already exists: ${active.id} (${active.status})`);
    const t = now(); const jobId = id(); const task = { id: id(), projectId: input.projectId, title: `キーワード探索: ${goal}`, description: `Discovery job ${jobId}`, status: 'todo', priority: 80, assigneeType: 'agent', relatedType: 'discovery_job', relatedId: jobId, createdAt: t, updatedAt: t };
    await db.insert(schema.tasks).values(task);
    const row = { id: jobId, projectId: input.projectId, seedKeywordsJson: JSON.stringify(seeds), targetUrl, goal, language: (input.language ?? project.language).trim().toLowerCase(), country: (input.country ?? project.country).trim().toLowerCase(), region: input.region?.trim() || project.region, excludedTermsJson: JSON.stringify(input.excludedTerms ?? parseStrings(project.excludedTermsJson)), maxCandidates: Math.max(1, Math.min(Math.floor(input.maxCandidates ?? project.discoveryMaxCandidates), 500)), candidateWritesUsed: 0, maxExternalRequests: Math.max(1, Math.min(Math.floor(input.maxExternalRequests ?? project.discoveryMaxExternalRequests), 50)), externalRequestsUsed: 0, status: 'waiting_for_agent', taskId: task.id, workSessionId: null, executorId: null, heartbeatAt: null, leaseExpiresAt: null, startedAt: null, completedAt: null, error: null, createdAt: t, updatedAt: t };
    await db.insert(schema.discoveryJobs).values(row); return { job: jobView(row), task };
  }),

  claim: async (ctx: CommandContext, input: { projectId: string; jobId: string; leaseSeconds?: number }) => withRun(projectCtx(ctx, input.projectId), 'discovery.claim', input, async () => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('Discovery execution must be claimed by an agent');
    const executorId = ctx.actorId ?? 'system'; const t = now(); const expires = leaseUntil(input.leaseSeconds);
    const claimed = sqlite.prepare("UPDATE discovery_jobs SET status = 'running', executor_id = ?, heartbeat_at = ?, lease_expires_at = ?, started_at = COALESCE(started_at, ?), error = NULL, updated_at = ? WHERE id = ? AND project_id = ? AND status = 'waiting_for_agent'").run(executorId, t, expires, t, t, input.jobId, input.projectId);
    if (claimed.changes !== 1) { const current = await requireJob(input.projectId, input.jobId); throw new Error(`Discovery job cannot be claimed from status ${current.status}`); }
    const job = await requireJob(input.projectId, input.jobId);
    try {
      const session = await workCommands.start(ctx, { projectId: input.projectId, objective: `Run discovery job: ${job.goal}`, completionCriteria: ['Collect bounded candidate evidence within the discovery budget.', 'Leave candidates decision-ready with unresolved questions explicit.', 'Stop at candidate review; do not approve page plans.'], maxActions: Math.min(50, job.maxExternalRequests + 12) });
      await db.update(schema.discoveryJobs).set({ workSessionId: session.id, updatedAt: now() }).where(eq(schema.discoveryJobs.id, job.id));
      if (job.taskId) await db.update(schema.tasks).set({ status: 'doing', updatedAt: now() }).where(eq(schema.tasks.id, job.taskId));
      return { jobId: job.id, status: 'running', workSessionId: session.id, executorId, leaseExpiresAt: expires, externalBudget: { used: job.externalRequestsUsed, max: job.maxExternalRequests } };
    } catch (error) {
      sqlite.prepare("UPDATE discovery_jobs SET status = 'waiting_for_agent', executor_id = NULL, heartbeat_at = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND executor_id = ? AND work_session_id IS NULL").run(now(), job.id, executorId);
      throw error;
    }
  }),

  heartbeat: async (ctx: CommandContext, input: { projectId: string; jobId: string; leaseSeconds?: number }) => withRun(projectCtx(ctx, input.projectId), 'discovery.heartbeat', input, async () => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('Discovery heartbeat is an agent operation'); const job = await requireJob(input.projectId, input.jobId); requireExecutionLease(ctx, job);
    const t = now(); const expires = leaseUntil(input.leaseSeconds); const executorId = ctx.actor === 'system' ? job.executorId : ctx.actorId;
    const result = sqlite.prepare("UPDATE discovery_jobs SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ? WHERE id = ? AND status = 'running' AND executor_id = ?").run(t, expires, t, job.id, executorId);
    if (result.changes !== 1) throw new Error('Discovery heartbeat failed because executor ownership changed'); return { jobId: job.id, heartbeatAt: t, leaseExpiresAt: expires };
  }),

  recoverExpired: async (ctx: CommandContext, input: { projectId: string; jobId: string }) => withRun(projectCtx(ctx, input.projectId), 'discovery.recover_expired', input, async () => {
    if (ctx.actor !== 'human' && ctx.actor !== 'system') throw new Error('Expired executor recovery requires a human or system actor'); const job = await requireJob(input.projectId, input.jobId);
    if (job.status !== 'running') return { jobId: job.id, recovered: false, status: job.status, reason: 'not_running' };
    if (job.leaseExpiresAt && Date.now() < new Date(job.leaseExpiresAt).getTime()) return { jobId: job.id, recovered: false, status: job.status, reason: 'lease_active', leaseExpiresAt: job.leaseExpiresAt };
    if (job.workSessionId) { try { await workCommands.cancel(projectCtx({ ...ctx, actor: 'system', actorId: 'lease-recovery' }, input.projectId, job.workSessionId), { projectId: input.projectId, sessionId: job.workSessionId, reason: 'Discovery executor lease expired.' }); } catch { /* session may already be terminal */ } }
    const t = now(); await db.update(schema.discoveryJobs).set({ status: 'waiting_for_agent', workSessionId: null, executorId: null, heartbeatAt: null, leaseExpiresAt: null, error: 'Previous executor lease expired and was recovered.', updatedAt: t }).where(eq(schema.discoveryJobs.id, job.id));
    if (job.taskId) await db.update(schema.tasks).set({ status: 'todo', updatedAt: t }).where(eq(schema.tasks.id, job.taskId)); return { jobId: job.id, recovered: true, status: 'waiting_for_agent' };
  }),

  importCandidates: async (ctx: CommandContext, input: { projectId: string; jobId: string; candidates: Array<{ keyword: string; demandValue?: number | null; demandProvider?: string | null; observedAt?: string | null; adCompetition?: number | null; sourceId?: string | null }> }) => withRun(projectCtx(ctx, input.projectId), 'discovery.import_candidates', input, async () => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('Candidate import is an agent operation'); const job = await requireJob(input.projectId, input.jobId); return importCandidateRows(ctx, job, input.candidates.slice(0, 500));
  }),

  adsIdeas: async (ctx: CommandContext, input: { projectId: string; jobId: string; seedKeywords?: string[]; url?: string; languageId?: string; geoTargetIds?: string[]; idempotencyKey?: string }) => withRun(projectCtx(ctx, input.projectId), 'discovery.ads_ideas', input, async () => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('External discovery research is an agent operation'); const job = await requireJob(input.projectId, input.jobId);
    const key = requestKey('ads', { seeds: input.seedKeywords ?? parseStrings(job.seedKeywordsJson), url: input.url ?? job.targetUrl, languageId: input.languageId, geo: input.geoTargetIds ?? [] }, input.idempotencyKey); const reserved = reserveExternalRequest(ctx, job, 'google_ads', key);
    if (reserved.cached) { const cached = await cachedSource(reserved.reservation.source_id); return { sourceId: reserved.reservation.source_id, cached: true, result: cached?.metadata?.result ?? null, imported: null }; }
    try {
      const result = await googleAdsKeywordIdeas({ seedKeywords: input.seedKeywords?.length ? input.seedKeywords : parseStrings(job.seedKeywordsJson), url: input.url ?? job.targetUrl ?? undefined, languageId: input.languageId, geoTargetIds: input.geoTargetIds });
      await recordProviderCapability(job.projectId, 'google_ads', 'available'); const source = { id: id(), projectId: job.projectId, type: 'google_ads', label: `Google Ads ideas: ${job.goal}`, url: job.targetUrl, metadataJson: JSON.stringify({ jobId: job.id, requestKey: key, request: { seeds: input.seedKeywords ?? parseStrings(job.seedKeywordsJson), language: job.language, country: job.country, region: job.region }, result }), createdAt: result.fetchedAt };
      await db.insert(schema.sources).values(source); await linkSource(job.projectId, source.id, 'discovery_job', job.id, 'provider_result'); const refreshedJob = await requireJob(job.projectId, job.id); const imported = await importCandidateRows(ctx, refreshedJob, result.ideas.map(idea => ({ keyword: idea.text, demandValue: idea.avgMonthly, demandProvider: 'google_ads', observedAt: result.fetchedAt, adCompetition: idea.competitionIndex === null ? null : idea.competitionIndex / 100, sourceId: source.id }))); settleReservation(reserved.reservation.id, 'succeeded', source.id); return { sourceId: source.id, cached: false, fetched: result.ideas.length, imported };
    } catch (error) { settleReservation(reserved.reservation.id, 'failed', null, error); await recordProviderCapability(job.projectId, 'google_ads', capabilityStatus(error), error); throw error; }
  }),

  serp: async (ctx: CommandContext, input: { projectId: string; jobId: string; candidateId: string; num?: number; idempotencyKey?: string }) => withRun(projectCtx(ctx, input.projectId), 'discovery.serp', input, async () => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('External discovery research is an agent operation'); const job = await requireJob(input.projectId, input.jobId); const candidate = await requireCandidate(input.projectId, input.jobId, input.candidateId); const key = requestKey('serp', { candidateId: candidate.id, keyword: candidate.keyword, num: input.num ?? 10, language: job.language, country: job.country, region: job.region }, input.idempotencyKey); const reserved = reserveExternalRequest(ctx, job, 'serp', key);
    if (reserved.cached) { const cached = await cachedSource(reserved.reservation.source_id); return { sourceId: reserved.reservation.source_id, cached: true, result: cached?.metadata?.result ?? null }; }
    try {
      const result = await searchSerp({ query: candidate.keyword, country: job.country, language: job.language, location: job.region ?? undefined, num: input.num ?? 10 }); await recordProviderCapability(job.projectId, 'serp', 'available'); const source = { id: id(), projectId: job.projectId, type: 'serp', label: `SERP: ${candidate.keyword}`, url: null, metadataJson: JSON.stringify({ jobId: job.id, candidateId: candidate.id, requestKey: key, result }), createdAt: result.fetchedAt };
      await db.insert(schema.sources).values(source); const linked = await linkSource(job.projectId, source.id, 'discovery_candidate', candidate.id, 'serp'); await db.update(schema.discoveryCandidates).set({ serpStatus: 'researched', evidenceCount: candidate.evidenceCount + (linked ? 1 : 0), updatedAt: now() }).where(eq(schema.discoveryCandidates.id, candidate.id)); settleReservation(reserved.reservation.id, 'succeeded', source.id); return { sourceId: source.id, cached: false, result };
    } catch (error) { settleReservation(reserved.reservation.id, 'failed', null, error); await recordProviderCapability(job.projectId, 'serp', capabilityStatus(error), error); await db.update(schema.discoveryCandidates).set({ serpStatus: 'failed', updatedAt: now() }).where(eq(schema.discoveryCandidates.id, candidate.id)); throw error; }
  }),

  webEvidence: async (ctx: CommandContext, input: { projectId: string; jobId: string; candidateId: string; url: string; idempotencyKey?: string }) => withRun(projectCtx(ctx, input.projectId), 'discovery.web_evidence', input, async () => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('External discovery research is an agent operation'); const job = await requireJob(input.projectId, input.jobId); const candidate = await requireCandidate(input.projectId, input.jobId, input.candidateId); const key = requestKey('web', { candidateId: candidate.id, url: input.url }, input.idempotencyKey); const reserved = reserveExternalRequest(ctx, job, 'public_web', key);
    if (reserved.cached) { const cached = await cachedSource(reserved.reservation.source_id); return { sourceId: reserved.reservation.source_id, cached: true, document: cached?.metadata?.document ?? null }; }
    try {
      const document = await fetchWebDocument({ url: input.url }); await recordProviderCapability(job.projectId, 'public_web', 'available'); const source = { id: id(), projectId: job.projectId, type: 'web', label: document.title || document.finalUrl, url: document.finalUrl, metadataJson: JSON.stringify({ jobId: job.id, candidateId: candidate.id, requestKey: key, document }), createdAt: document.fetchedAt };
      await db.insert(schema.sources).values(source); const linked = await linkSource(job.projectId, source.id, 'discovery_candidate', candidate.id, 'web'); await db.update(schema.discoveryCandidates).set({ evidenceCount: candidate.evidenceCount + (linked ? 1 : 0), updatedAt: now() }).where(eq(schema.discoveryCandidates.id, candidate.id)); settleReservation(reserved.reservation.id, 'succeeded', source.id); return { sourceId: source.id, cached: false, document };
    } catch (error) { settleReservation(reserved.reservation.id, 'failed', null, error); await recordProviderCapability(job.projectId, 'public_web', capabilityStatus(error), error); throw error; }
  }),

  annotate: async (ctx: CommandContext, input: { projectId: string; jobId: string; candidateId: string; searchIntent?: string | null; unresolvedQuestions?: string[] }) => withRun(projectCtx(ctx, input.projectId), 'discovery.annotate', input, async () => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('Candidate annotation is an agent operation'); const job = await requireJob(input.projectId, input.jobId); requireExecutionLease(ctx, job); const candidate = await requireCandidate(input.projectId, input.jobId, input.candidateId); const updatedAt = now();
    const values = { searchIntent: input.searchIntent === undefined ? candidate.searchIntent : input.searchIntent?.trim() || null, unresolvedQuestionsJson: input.unresolvedQuestions === undefined ? candidate.unresolvedQuestionsJson : JSON.stringify(input.unresolvedQuestions.map(x => x.trim()).filter(Boolean)), updatedAt };
    await db.update(schema.discoveryCandidates).set(values).where(eq(schema.discoveryCandidates.id, candidate.id)); return candidateView({ ...candidate, ...values });
  }),

  finishResearch: async (ctx: CommandContext, input: { projectId: string; jobId: string; summary: string }) => withRun(projectCtx(ctx, input.projectId), 'discovery.finish_research', input, async () => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('Discovery research completion is an agent operation'); const job = await requireJob(input.projectId, input.jobId); requireExecutionLease(ctx, job); const countRows = await db.select().from(schema.discoveryCandidates).where(eq(schema.discoveryCandidates.jobId, job.id)); if (!countRows.length) throw new Error('Cannot finish discovery without candidates');
    if (job.workSessionId) await workCommands.complete(projectCtx(ctx, input.projectId, job.workSessionId), { projectId: input.projectId, sessionId: job.workSessionId, summary: input.summary.trim() || `Prepared ${countRows.length} discovery candidates for human review.` }); const t = now(); await db.update(schema.discoveryJobs).set({ status: 'awaiting_review', executorId: null, heartbeatAt: null, leaseExpiresAt: null, updatedAt: t }).where(eq(schema.discoveryJobs.id, job.id)); if (job.taskId) await db.update(schema.tasks).set({ status: 'review', updatedAt: t }).where(eq(schema.tasks.id, job.taskId)); return { jobId: job.id, status: 'awaiting_review', candidates: countRows.length };
  }),

  reviewCandidate: async (ctx: CommandContext, input: { projectId: string; jobId: string; candidateId: string; status: CandidateStatus; reason?: string }) => withRun(projectCtx(ctx, input.projectId), 'discovery.review_candidate', input, async () => {
    if (ctx.actor !== 'human') throw new Error('Candidate review requires a human actor'); const job = await requireJob(input.projectId, input.jobId); const candidate = await requireCandidate(input.projectId, input.jobId, input.candidateId); if (!['awaiting_review','completed','waiting_for_agent'].includes(job.status)) throw new Error(`Candidates cannot be reviewed while job is ${job.status}`); const allowed: CandidateStatus[] = ['shortlisted','hold','rejected','research_more']; if (!allowed.includes(input.status)) throw new Error('Invalid human candidate status'); const t = now(); await db.update(schema.discoveryCandidates).set({ status: input.status, updatedAt: t }).where(eq(schema.discoveryCandidates.id, candidate.id)); await db.insert(schema.decisions).values({ id: id(), projectId: input.projectId, actor: 'human', action: 'discovery.candidate_review', targetType: 'discovery_candidate', targetId: candidate.id, verdict: input.status, reason: input.reason?.trim() || null, metadataJson: JSON.stringify({ jobId: job.id, keyword: candidate.keyword }), createdAt: t }); const jobStatus = await reconcileJobAfterReview(input.projectId, job.id); return { candidateId: candidate.id, status: input.status, jobStatus };
  }),

  bulkReviewCandidates: async (ctx: CommandContext, input: { projectId: string; candidateIds: string[]; status: 'shortlisted' | 'hold' | 'rejected'; reason?: string }) => withRun(projectCtx(ctx, input.projectId), 'discovery.bulk_review_candidates', input, async () => {
    if (ctx.actor !== 'human') throw new Error('Bulk candidate review requires a human actor'); const ids = [...new Set(input.candidateIds.filter(Boolean))].slice(0, 500); if (!ids.length) return { updated: 0, jobStatuses: {} };
    const rows = await db.select().from(schema.discoveryCandidates).where(and(eq(schema.discoveryCandidates.projectId, input.projectId), inArray(schema.discoveryCandidates.id, ids))); if (rows.length !== ids.length) throw new Error('One or more candidates do not belong to the project'); const jobs = [...new Set(rows.map(row => row.jobId))];
    for (const jobId of jobs) { const job = await requireJob(input.projectId, jobId); if (!['awaiting_review','completed','waiting_for_agent'].includes(job.status)) throw new Error(`Candidates for job ${jobId} cannot be reviewed while it is ${job.status}`); }
    const t = now(); for (const row of rows) { await db.update(schema.discoveryCandidates).set({ status: input.status, updatedAt: t }).where(eq(schema.discoveryCandidates.id, row.id)); await db.insert(schema.decisions).values({ id: id(), projectId: input.projectId, actor: 'human', action: 'discovery.candidate_review', targetType: 'discovery_candidate', targetId: row.id, verdict: input.status, reason: input.reason?.trim() || null, metadataJson: JSON.stringify({ jobId: row.jobId, keyword: row.keyword, bulk: true }), createdAt: t }); }
    const jobStatuses: Record<string, string> = {}; for (const jobId of jobs) jobStatuses[jobId] = await reconcileJobAfterReview(input.projectId, jobId); return { updated: rows.length, jobStatuses };
  }),

  cancel: async (ctx: CommandContext, input: { projectId: string; jobId: string; reason?: string }) => withRun(projectCtx(ctx, input.projectId), 'discovery.cancel', input, async () => {
    if (ctx.actor !== 'human') throw new Error('Discovery cancellation requires a human actor'); const job = await requireJob(input.projectId, input.jobId); const t = now(); if (job.workSessionId) { try { await workCommands.cancel(projectCtx({ ...ctx, actor: 'system', actorId: 'human-cancel' }, input.projectId, job.workSessionId), { projectId: input.projectId, sessionId: job.workSessionId, reason: input.reason?.trim() || 'Discovery cancelled by human.' }); } catch { /* terminal session */ } }
    await db.update(schema.discoveryJobs).set({ status: 'cancelled', completedAt: t, executorId: null, heartbeatAt: null, leaseExpiresAt: null, error: input.reason?.trim() || null, updatedAt: t }).where(eq(schema.discoveryJobs.id, job.id)); if (job.taskId) await db.update(schema.tasks).set({ status: 'done', updatedAt: t }).where(eq(schema.tasks.id, job.taskId)); return { jobId: job.id, status: 'cancelled' as DiscoveryJobStatus };
  })
};