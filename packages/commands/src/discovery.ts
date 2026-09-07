import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CandidateStatus, CommandContext, DiscoveryJobStatus } from '@keywords/domain';
import { fetchWebDocument, googleAdsKeywordIdeas, searchSerp } from '@keywords/research';
import { workCommands } from './work.js';
import { recordProviderCapability } from './workspace.js';

const { db } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const projectCtx = (ctx: CommandContext, projectId: string, workSessionId?: string): CommandContext => ({ ...ctx, projectId, workSessionId: workSessionId ?? ctx.workSessionId });
const parseStrings = (value: string | null) => { try { const parsed = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };
const parseJson = (value: string | null) => { try { return value ? JSON.parse(value) : null; } catch { return null; } };

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
  return { ...job, seedKeywords: parseStrings(job.seedKeywordsJson), excludedTerms: parseStrings(job.excludedTermsJson), seedKeywordsJson: undefined, excludedTermsJson: undefined };
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
async function consumeExternalBudget(job: typeof schema.discoveryJobs.$inferSelect, count = 1) {
  if (!['running'].includes(job.status)) throw new Error(`Discovery job is ${job.status}; external research is not allowed`);
  if (job.externalRequestsUsed + count > job.maxExternalRequests) throw new Error(`Discovery external request budget exhausted (${job.externalRequestsUsed}/${job.maxExternalRequests})`);
  await db.update(schema.discoveryJobs).set({ externalRequestsUsed: job.externalRequestsUsed + count, updatedAt: now() }).where(eq(schema.discoveryJobs.id, job.id));
}
async function upsertKeyword(projectId: string, input: { text: string; source: string; avgMonthly?: number | null; competition?: number | null; cpcMicros?: number | null }) {
  const normalized = normalize(input.text);
  if (!normalized) throw new Error('Keyword text is required');
  const existing = await db.select().from(schema.keywords).where(and(eq(schema.keywords.projectId, projectId), eq(schema.keywords.normalized, normalized))).get();
  if (existing) {
    await db.update(schema.keywords).set({ avgMonthly: input.avgMonthly ?? existing.avgMonthly, competition: input.competition ?? existing.competition, cpcMicros: input.cpcMicros ?? existing.cpcMicros, updatedAt: now() }).where(eq(schema.keywords.id, existing.id));
    return existing.id;
  }
  const t = now(); const row = { id: id(), projectId, topicId: null, text: input.text.trim(), normalized, source: input.source, status: 'active', avgMonthly: input.avgMonthly ?? null, competition: input.competition ?? null, cpcMicros: input.cpcMicros ?? null, gscClicks: null, gscImpressions: null, gscCtr: null, gscPosition: null, gscUpdatedAt: null, createdAt: t, updatedAt: t };
  await db.insert(schema.keywords).values(row); return row.id;
}
async function overlapsForKeyword(projectId: string, keywordId: string) {
  return db.select({ id: schema.pages.id, title: schema.pages.title, url: schema.pages.url, status: schema.pages.status, role: schema.pageKeywords.role }).from(schema.pageKeywords).innerJoin(schema.pages, eq(schema.pageKeywords.pageId, schema.pages.id)).where(and(eq(schema.pages.projectId, projectId), eq(schema.pageKeywords.keywordId, keywordId), ne(schema.pages.status, 'archived')));
}
async function linkSource(projectId: string, sourceId: string, targetType: string, targetId: string, kind: string) {
  const existing = await db.select().from(schema.sourceLinks).where(and(eq(schema.sourceLinks.sourceId, sourceId), eq(schema.sourceLinks.targetType, targetType), eq(schema.sourceLinks.targetId, targetId), eq(schema.sourceLinks.kind, kind))).get();
  if (!existing) await db.insert(schema.sourceLinks).values({ id: id(), projectId, sourceId, targetType, targetId, kind, createdAt: now() });
}

async function importCandidateRows(job: typeof schema.discoveryJobs.$inferSelect, rows: Array<{ keyword: string; demandValue?: number | null; adCompetition?: number | null; demandProvider?: string | null; observedAt?: string | null; sourceId?: string | null }>) {
  const excluded = parseStrings(job.excludedTermsJson).map(normalize);
  const existing = await db.select().from(schema.discoveryCandidates).where(eq(schema.discoveryCandidates.jobId, job.id));
  let remaining = Math.max(0, job.maxCandidates - existing.length);
  let created = 0; let updated = 0;
  const candidateIds: string[] = [];
  for (const input of rows) {
    if (remaining <= 0) break;
    const normalized = normalize(input.keyword);
    if (!normalized || excluded.some(term => term && normalized.includes(term))) continue;
    const current = existing.find(row => row.normalized === normalized) ?? await db.select().from(schema.discoveryCandidates).where(and(eq(schema.discoveryCandidates.jobId, job.id), eq(schema.discoveryCandidates.normalized, normalized))).get();
    const keywordId = await upsertKeyword(job.projectId, { text: input.keyword, source: input.demandProvider ?? 'discovery', avgMonthly: input.demandValue ?? null, competition: input.adCompetition ?? null });
    const overlap = await overlapsForKeyword(job.projectId, keywordId);
    const t = now();
    if (current) {
      await db.update(schema.discoveryCandidates).set({ keywordId, demandValue: input.demandValue ?? current.demandValue, demandProvider: input.demandProvider ?? current.demandProvider, demandObservedAt: input.observedAt ?? current.demandObservedAt, adCompetition: input.adCompetition ?? current.adCompetition, existingPageOverlapJson: JSON.stringify(overlap), updatedAt: t }).where(eq(schema.discoveryCandidates.id, current.id));
      if (input.sourceId) { await linkSource(job.projectId, input.sourceId, 'discovery_candidate', current.id, 'demand'); await db.update(schema.discoveryCandidates).set({ evidenceCount: current.evidenceCount + 1 }).where(eq(schema.discoveryCandidates.id, current.id)); }
      candidateIds.push(current.id); updated++;
    } else {
      const row = { id: id(), projectId: job.projectId, jobId: job.id, keywordId, keyword: input.keyword.trim(), normalized, status: 'discovered', demandValue: input.demandValue ?? null, demandProvider: input.demandProvider ?? null, demandObservedAt: input.observedAt ?? null, adCompetition: input.adCompetition ?? null, searchIntent: null, existingPageOverlapJson: JSON.stringify(overlap), serpStatus: 'not_researched', unresolvedQuestionsJson: null, evidenceCount: input.sourceId ? 1 : 0, language: job.language, country: job.country, region: job.region, createdAt: t, updatedAt: t };
      await db.insert(schema.discoveryCandidates).values(row);
      if (input.sourceId) await linkSource(job.projectId, input.sourceId, 'discovery_candidate', row.id, 'demand');
      candidateIds.push(row.id); created++; remaining--;
    }
  }
  return { created, updated, candidateIds, capped: remaining <= 0 };
}

export const discoveryCommands = {
  list: async (ctx: CommandContext, projectId: string, limit = 30) => withRun(projectCtx(ctx, projectId), 'discovery.list', { projectId, limit }, async () => {
    const rows = await db.select().from(schema.discoveryJobs).where(eq(schema.discoveryJobs.projectId, projectId)).orderBy(desc(schema.discoveryJobs.createdAt)).limit(Math.max(1, Math.min(limit, 100)));
    return Promise.all(rows.map(async job => ({ ...jobView(job), candidateCounts: Object.fromEntries(['discovered','shortlisted','hold','rejected','research_more'].map(status => [status, 0])) }))).then(async views => {
      for (const view of views) { const candidates = await db.select().from(schema.discoveryCandidates).where(eq(schema.discoveryCandidates.jobId, view.id)); for (const c of candidates) view.candidateCounts[c.status] = (view.candidateCounts[c.status] ?? 0) + 1; }
      return views;
    });
  }),

  detail: async (ctx: CommandContext, input: { projectId: string; jobId: string }) => withRun(projectCtx(ctx, input.projectId), 'discovery.detail', input, async () => {
    const job = await requireJob(input.projectId, input.jobId);
    const candidates = await db.select().from(schema.discoveryCandidates).where(eq(schema.discoveryCandidates.jobId, job.id)).orderBy(desc(schema.discoveryCandidates.demandValue), schema.discoveryCandidates.keyword);
    return { job: jobView(job), candidates: candidates.map(candidateView) };
  }),

  start: async (ctx: CommandContext, input: { projectId: string; seedKeywords?: string[]; targetUrl?: string; goal: string; language?: string; country?: string; region?: string; excludedTerms?: string[]; maxCandidates?: number; maxExternalRequests?: number }) => withRun(projectCtx(ctx, input.projectId), 'discovery.start', input, async () => {
    if (ctx.actor !== 'human') throw new Error('Starting a discovery job requires a human actor');
    const project = await requireProject(input.projectId);
    const seeds = [...new Set((input.seedKeywords ?? []).map(x => x.trim()).filter(Boolean))];
    const targetUrl = input.targetUrl?.trim() || null;
    if (!seeds.length && !targetUrl) throw new Error('At least one seed keyword or target URL is required');
    const goal = input.goal.trim(); if (!goal) throw new Error('Discovery goal is required');
    const active = await db.select().from(schema.discoveryJobs).where(and(eq(schema.discoveryJobs.projectId, input.projectId), inArray(schema.discoveryJobs.status, ['waiting_for_agent','running','awaiting_review','blocked']))).orderBy(desc(schema.discoveryJobs.updatedAt)).get();
    if (active) throw new Error(`An unfinished discovery job already exists: ${active.id} (${active.status})`);
    const t = now(); const jobId = id();
    const task = { id: id(), projectId: input.projectId, title: `キーワード探索: ${goal}`, description: `Discovery job ${jobId}`, status: 'todo', priority: 80, assigneeType: 'agent', relatedType: 'discovery_job', relatedId: jobId, createdAt: t, updatedAt: t };
    await db.insert(schema.tasks).values(task);
    const row = { id: jobId, projectId: input.projectId, seedKeywordsJson: JSON.stringify(seeds), targetUrl, goal, language: (input.language ?? project.language).trim().toLowerCase(), country: (input.country ?? project.country).trim().toLowerCase(), region: input.region?.trim() || project.region, excludedTermsJson: JSON.stringify(input.excludedTerms ?? parseStrings(project.excludedTermsJson)), maxCandidates: Math.max(1, Math.min(Math.floor(input.maxCandidates ?? project.discoveryMaxCandidates), 500)), maxExternalRequests: Math.max(1, Math.min(Math.floor(input.maxExternalRequests ?? project.discoveryMaxExternalRequests), 50)), externalRequestsUsed: 0, status: 'waiting_for_agent', taskId: task.id, workSessionId: null, startedAt: null, completedAt: null, error: null, createdAt: t, updatedAt: t };
    await db.insert(schema.discoveryJobs).values(row);
    return { job: jobView(row), task };
  }),

  claim: async (ctx: CommandContext, input: { projectId: string; jobId: string }) => withRun(projectCtx(ctx, input.projectId), 'discovery.claim', input, async () => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('Discovery execution must be claimed by an agent');
    const job = await requireJob(input.projectId, input.jobId);
    if (!['waiting_for_agent','blocked'].includes(job.status)) throw new Error(`Discovery job cannot be claimed from status ${job.status}`);
    const session = await workCommands.start(ctx, { projectId: input.projectId, objective: `Run discovery job: ${job.goal}`, completionCriteria: ['Collect bounded candidate evidence within the discovery budget.', 'Leave candidates decision-ready with unresolved questions explicit.', 'Stop at candidate review; do not approve page plans.'], maxActions: Math.min(50, job.maxExternalRequests + 12) });
    const t = now();
    await db.update(schema.discoveryJobs).set({ status: 'running', workSessionId: session.id, startedAt: job.startedAt ?? t, error: null, updatedAt: t }).where(eq(schema.discoveryJobs.id, job.id));
    if (job.taskId) await db.update(schema.tasks).set({ status: 'doing', updatedAt: t }).where(eq(schema.tasks.id, job.taskId));
    return { jobId: job.id, status: 'running', workSessionId: session.id, externalBudget: { used: job.externalRequestsUsed, max: job.maxExternalRequests } };
  }),

  importCandidates: async (ctx: CommandContext, input: { projectId: string; jobId: string; candidates: Array<{ keyword: string; demandValue?: number | null; demandProvider?: string | null; observedAt?: string | null; adCompetition?: number | null; sourceId?: string | null }> }) => withRun(projectCtx(ctx, input.projectId), 'discovery.import_candidates', input, async () => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('Candidate import is an agent operation');
    const job = await requireJob(input.projectId, input.jobId); if (job.status !== 'running') throw new Error(`Discovery job is ${job.status}`);
    return importCandidateRows(job, input.candidates.slice(0, 500));
  }),

  adsIdeas: async (ctx: CommandContext, input: { projectId: string; jobId: string; seedKeywords?: string[]; url?: string; languageId?: string; geoTargetIds?: string[] }) => withRun(projectCtx(ctx, input.projectId), 'discovery.ads_ideas', input, async () => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('External discovery research is an agent operation');
    const job = await requireJob(input.projectId, input.jobId); await consumeExternalBudget(job, 1);
    try {
      const result = await googleAdsKeywordIdeas({ seedKeywords: input.seedKeywords?.length ? input.seedKeywords : parseStrings(job.seedKeywordsJson), url: input.url ?? job.targetUrl ?? undefined, languageId: input.languageId, geoTargetIds: input.geoTargetIds });
      await recordProviderCapability(job.projectId, 'google_ads', 'available');
      const source = { id: id(), projectId: job.projectId, type: 'google_ads', label: `Google Ads ideas: ${job.goal}`, url: job.targetUrl, metadataJson: JSON.stringify({ jobId: job.id, request: { seeds: input.seedKeywords ?? parseStrings(job.seedKeywordsJson), language: job.language, country: job.country, region: job.region }, result }), createdAt: result.fetchedAt };
      await db.insert(schema.sources).values(source); await linkSource(job.projectId, source.id, 'discovery_job', job.id, 'provider_result');
      const imported = await importCandidateRows({ ...job, externalRequestsUsed: job.externalRequestsUsed + 1 }, result.ideas.map(idea => ({ keyword: idea.text, demandValue: idea.avgMonthly, demandProvider: 'google_ads', observedAt: result.fetchedAt, adCompetition: idea.competitionIndex === null ? null : idea.competitionIndex / 100, sourceId: source.id })));
      return { sourceId: source.id, fetched: result.ideas.length, imported };
    } catch (error) { await recordProviderCapability(job.projectId, 'google_ads', capabilityStatus(error), error); throw error; }
  }),

  serp: async (ctx: CommandContext, input: { projectId: string; jobId: string; candidateId: string; num?: number }) => withRun(projectCtx(ctx, input.projectId), 'discovery.serp', input, async () => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('External discovery research is an agent operation');
    const job = await requireJob(input.projectId, input.jobId); const candidate = await requireCandidate(input.projectId, input.jobId, input.candidateId); await consumeExternalBudget(job, 1);
    try {
      const result = await searchSerp({ query: candidate.keyword, country: job.country, language: job.language, location: job.region ?? undefined, num: input.num ?? 10 });
      await recordProviderCapability(job.projectId, 'serp', 'available');
      const source = { id: id(), projectId: job.projectId, type: 'serp', label: `SERP: ${candidate.keyword}`, url: null, metadataJson: JSON.stringify({ jobId: job.id, candidateId: candidate.id, result }), createdAt: result.fetchedAt };
      await db.insert(schema.sources).values(source); await linkSource(job.projectId, source.id, 'discovery_candidate', candidate.id, 'serp');
      await db.update(schema.discoveryCandidates).set({ serpStatus: 'researched', evidenceCount: candidate.evidenceCount + 1, updatedAt: now() }).where(eq(schema.discoveryCandidates.id, candidate.id));
      return { sourceId: source.id, result };
    } catch (error) { await recordProviderCapability(job.projectId, 'serp', capabilityStatus(error), error); await db.update(schema.discoveryCandidates).set({ serpStatus: 'failed', updatedAt: now() }).where(eq(schema.discoveryCandidates.id, candidate.id)); throw error; }
  }),

  webEvidence: async (ctx: CommandContext, input: { projectId: string; jobId: string; candidateId: string; url: string }) => withRun(projectCtx(ctx, input.projectId), 'discovery.web_evidence', input, async () => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('External discovery research is an agent operation');
    const job = await requireJob(input.projectId, input.jobId); const candidate = await requireCandidate(input.projectId, input.jobId, input.candidateId); await consumeExternalBudget(job, 1);
    try {
      const document = await fetchWebDocument({ url: input.url }); await recordProviderCapability(job.projectId, 'public_web', 'available');
      const source = { id: id(), projectId: job.projectId, type: 'web', label: document.title || document.finalUrl, url: document.finalUrl, metadataJson: JSON.stringify({ jobId: job.id, candidateId: candidate.id, document }), createdAt: document.fetchedAt };
      await db.insert(schema.sources).values(source); await linkSource(job.projectId, source.id, 'discovery_candidate', candidate.id, 'web');
      await db.update(schema.discoveryCandidates).set({ evidenceCount: candidate.evidenceCount + 1, updatedAt: now() }).where(eq(schema.discoveryCandidates.id, candidate.id));
      return { sourceId: source.id, document };
    } catch (error) { await recordProviderCapability(job.projectId, 'public_web', capabilityStatus(error), error); throw error; }
  }),

  annotate: async (ctx: CommandContext, input: { projectId: string; jobId: string; candidateId: string; searchIntent?: string | null; unresolvedQuestions?: string[] }) => withRun(projectCtx(ctx, input.projectId), 'discovery.annotate', input, async () => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('Candidate annotation is an agent operation');
    const candidate = await requireCandidate(input.projectId, input.jobId, input.candidateId);
    await db.update(schema.discoveryCandidates).set({ searchIntent: input.searchIntent === undefined ? candidate.searchIntent : input.searchIntent?.trim() || null, unresolvedQuestionsJson: input.unresolvedQuestions === undefined ? candidate.unresolvedQuestionsJson : JSON.stringify(input.unresolvedQuestions.map(x => x.trim()).filter(Boolean)), updatedAt: now() }).where(eq(schema.discoveryCandidates.id, candidate.id));
    return candidateView({ ...candidate, searchIntent: input.searchIntent === undefined ? candidate.searchIntent : input.searchIntent?.trim() || null, unresolvedQuestionsJson: input.unresolvedQuestions === undefined ? candidate.unresolvedQuestionsJson : JSON.stringify(input.unresolvedQuestions.map(x => x.trim()).filter(Boolean)), updatedAt: now() });
  }),

  finishResearch: async (ctx: CommandContext, input: { projectId: string; jobId: string; summary: string }) => withRun(projectCtx(ctx, input.projectId), 'discovery.finish_research', input, async () => {
    if (ctx.actor !== 'agent' && ctx.actor !== 'system') throw new Error('Discovery research completion is an agent operation');
    const job = await requireJob(input.projectId, input.jobId); if (job.status !== 'running') throw new Error(`Discovery job is ${job.status}`);
    const countRows = await db.select().from(schema.discoveryCandidates).where(eq(schema.discoveryCandidates.jobId, job.id));
    if (!countRows.length) throw new Error('Cannot finish discovery without candidates');
    if (job.workSessionId) await workCommands.complete(projectCtx(ctx, input.projectId, job.workSessionId), { projectId: input.projectId, sessionId: job.workSessionId, summary: input.summary.trim() || `Prepared ${countRows.length} discovery candidates for human review.` });
    const t = now(); await db.update(schema.discoveryJobs).set({ status: 'awaiting_review', updatedAt: t }).where(eq(schema.discoveryJobs.id, job.id));
    if (job.taskId) await db.update(schema.tasks).set({ status: 'review', updatedAt: t }).where(eq(schema.tasks.id, job.taskId));
    return { jobId: job.id, status: 'awaiting_review', candidates: countRows.length };
  }),

  reviewCandidate: async (ctx: CommandContext, input: { projectId: string; jobId: string; candidateId: string; status: CandidateStatus; reason?: string }) => withRun(projectCtx(ctx, input.projectId), 'discovery.review_candidate', input, async () => {
    if (ctx.actor !== 'human') throw new Error('Candidate review requires a human actor');
    const job = await requireJob(input.projectId, input.jobId); const candidate = await requireCandidate(input.projectId, input.jobId, input.candidateId);
    if (!['awaiting_review','completed','waiting_for_agent'].includes(job.status)) throw new Error(`Candidates cannot be reviewed while job is ${job.status}`);
    const allowed: CandidateStatus[] = ['shortlisted','hold','rejected','research_more']; if (!allowed.includes(input.status)) throw new Error('Invalid human candidate status');
    const t = now(); await db.update(schema.discoveryCandidates).set({ status: input.status, updatedAt: t }).where(eq(schema.discoveryCandidates.id, candidate.id));
    await db.insert(schema.decisions).values({ id: id(), projectId: input.projectId, actor: 'human', action: 'discovery.candidate_review', targetType: 'discovery_candidate', targetId: candidate.id, verdict: input.status, reason: input.reason?.trim() || null, metadataJson: JSON.stringify({ jobId: job.id, keyword: candidate.keyword }), createdAt: t });
    const remaining = await db.select().from(schema.discoveryCandidates).where(and(eq(schema.discoveryCandidates.jobId, job.id), inArray(schema.discoveryCandidates.status, ['discovered','research_more'])));
    if (input.status === 'research_more') {
      await db.update(schema.discoveryJobs).set({ status: 'waiting_for_agent', workSessionId: null, updatedAt: t }).where(eq(schema.discoveryJobs.id, job.id));
      if (job.taskId) await db.update(schema.tasks).set({ status: 'todo', updatedAt: t }).where(eq(schema.tasks.id, job.taskId));
    } else if (!remaining.filter(row => row.id !== candidate.id || input.status === 'research_more').length) {
      await db.update(schema.discoveryJobs).set({ status: 'completed', completedAt: t, updatedAt: t }).where(eq(schema.discoveryJobs.id, job.id));
      await db.update(schema.projects).set({ lastDiscoveryAt: t, updatedAt: t }).where(eq(schema.projects.id, input.projectId));
      if (job.taskId) await db.update(schema.tasks).set({ status: 'done', updatedAt: t }).where(eq(schema.tasks.id, job.taskId));
    }
    return { candidateId: candidate.id, status: input.status };
  }),

  cancel: async (ctx: CommandContext, input: { projectId: string; jobId: string; reason?: string }) => withRun(projectCtx(ctx, input.projectId), 'discovery.cancel', input, async () => {
    if (ctx.actor !== 'human') throw new Error('Discovery cancellation requires a human actor');
    const job = await requireJob(input.projectId, input.jobId); const t = now();
    await db.update(schema.discoveryJobs).set({ status: 'cancelled', completedAt: t, error: input.reason?.trim() || null, updatedAt: t }).where(eq(schema.discoveryJobs.id, job.id));
    if (job.taskId) await db.update(schema.tasks).set({ status: 'done', updatedAt: t }).where(eq(schema.tasks.id, job.taskId));
    return { jobId: job.id, status: 'cancelled' as DiscoveryJobStatus };
  })
};
