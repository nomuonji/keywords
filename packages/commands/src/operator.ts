import { and, desc, eq, isNull, ne, or } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { discoveryCommands } from './discovery.js';
import { blogNextActions } from './blog.js';
import { measurementComparisonContext } from './measurement.js';
import { operationControl } from './guard.js';
import { googleAdsConfigured } from './workspace.js';
import { recoveryContext } from './recovery-context.js';

const { db, sqlite } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const projectCtx = (ctx: CommandContext, projectId: string): CommandContext => ({ ...ctx, projectId });

async function withRun<T>(ctx: CommandContext, command: string, input: unknown, fn: () => Promise<T>): Promise<T> {
  const runId = id(); const started = Date.now(); const createdAt = now();
  try { const output = await fn(); await db.insert(schema.runs).values({ id: runId, projectId: ctx.projectId ?? null, workSessionId: ctx.workSessionId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null, command, status: 'succeeded', inputJson: JSON.stringify(input ?? null), outputJson: JSON.stringify(output ?? null), durationMs: Date.now() - started, createdAt }); return output; }
  catch (error) { await db.insert(schema.runs).values({ id: runId, projectId: ctx.projectId ?? null, workSessionId: ctx.workSessionId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null, command, status: 'failed', inputJson: JSON.stringify(input ?? null), error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started, createdAt }); throw error; }
}

async function inspect(projectId: string) {
  const project = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get(); if (!project) throw new Error('Project not found');
  const [review, discovery, session, openTask, livePage, latestSnapshot, latestSitemap, unclustered, adsCapability] = await Promise.all([
    db.select().from(schema.reviewRequests).where(and(eq(schema.reviewRequests.projectId, projectId), eq(schema.reviewRequests.status, 'open'))).orderBy(desc(schema.reviewRequests.createdAt)).get(),
    db.select().from(schema.discoveryJobs).where(and(eq(schema.discoveryJobs.projectId, projectId), or(eq(schema.discoveryJobs.status, 'waiting_for_agent'), eq(schema.discoveryJobs.status, 'running'), eq(schema.discoveryJobs.status, 'awaiting_review'), eq(schema.discoveryJobs.status, 'blocked')))).orderBy(desc(schema.discoveryJobs.updatedAt)).get(),
    db.select().from(schema.workSessions).where(and(eq(schema.workSessions.projectId, projectId), or(eq(schema.workSessions.status, 'running'), eq(schema.workSessions.status, 'awaiting_review'), eq(schema.workSessions.status, 'blocked')))).orderBy(desc(schema.workSessions.updatedAt)).get(),
    db.select().from(schema.tasks).where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.assigneeType, 'agent'), ne(schema.tasks.status, 'done'))).orderBy(desc(schema.tasks.priority), desc(schema.tasks.updatedAt)).get(),
    db.select().from(schema.pages).where(and(eq(schema.pages.projectId, projectId), ne(schema.pages.url, ''))).orderBy(desc(schema.pages.lastSeenAt)).get(),
    db.select().from(schema.sources).where(and(eq(schema.sources.projectId, projectId), eq(schema.sources.type, 'gsc_snapshot'))).orderBy(desc(schema.sources.createdAt)).get(),
    db.select().from(schema.sources).where(and(eq(schema.sources.projectId, projectId), eq(schema.sources.type, 'sitemap'))).orderBy(desc(schema.sources.createdAt)).get(),
    db.select({ id: schema.keywords.id, text: schema.keywords.text, avgMonthly: schema.keywords.avgMonthly }).from(schema.keywords).leftJoin(schema.clusterKeywords, eq(schema.keywords.id, schema.clusterKeywords.keywordId)).where(and(eq(schema.keywords.projectId, projectId), ne(schema.keywords.status, 'rejected'), isNull(schema.clusterKeywords.keywordId))).orderBy(desc(schema.keywords.avgMonthly)).limit(10),
    db.select().from(schema.providerCapabilities).where(and(eq(schema.providerCapabilities.projectId, projectId), eq(schema.providerCapabilities.provider, 'google_ads'))).get()
  ]);

  const candidates: Array<Record<string, unknown>> = [];
  const recovery = recoveryContext(projectId);
  candidates.push(...blogNextActions(projectId));
  const control = operationControl(projectId);
  if (control.paused) candidates.push({ kind: 'operation_paused', rank: 0, title: 'Agent operations are paused', reason: control.reason ?? 'A human paused this project.', relatedType: 'project', relatedId: projectId });
  const leaseExpired = discovery?.status === 'running' && (!discovery.leaseExpiresAt || Date.now() >= new Date(discovery.leaseExpiresAt).getTime());
  if (review) candidates.push({ kind: 'await_review', rank: 1, title: review.title, reason: 'A human review request is open; autonomous work should not cross this boundary.', relatedType: 'review_request', relatedId: review.id });
  if (leaseExpired && discovery) candidates.push({ kind: 'recover_discovery', rank: 2, title: `Recover interrupted discovery: ${discovery.goal}`, reason: 'The discovery executor lease expired. Recover the shared job before another agent claims it.', relatedType: 'discovery_job', relatedId: discovery.id });
  else if (discovery?.status === 'awaiting_review') candidates.push({ kind: 'review_discovery', rank: 2, title: `Review discovery: ${discovery.goal}`, reason: 'Discovery research is complete and candidates need review or delegated triage.', relatedType: 'discovery_job', relatedId: discovery.id });
  else if (discovery?.status === 'waiting_for_agent') candidates.push({ kind: 'claim_discovery', rank: 2, title: `Run discovery: ${discovery.goal}`, reason: 'A discovery job is waiting for an executor lease.', relatedType: 'discovery_job', relatedId: discovery.id });
  else if (discovery?.status === 'running') candidates.push({ kind: 'resume_discovery', rank: 2, title: `Continue discovery: ${discovery.goal}`, reason: `Discovery is running under executor ${discovery.executorId ?? 'unknown'}; lease expires ${discovery.leaseExpiresAt ?? 'unknown'}.`, relatedType: 'discovery_job', relatedId: discovery.id });
  if (session && !leaseExpired) candidates.push({ kind: 'resume_session', rank: 3, title: session.objective, reason: `An unfinished work session is ${session.status}.`, relatedType: 'work_session', relatedId: session.id });
  if (openTask) candidates.push({ kind: 'existing_task', rank: 4, title: openTask.title, reason: `The shared agent queue already has an open priority-${openTask.priority} task.`, relatedType: 'task', relatedId: openTask.id });

  const comparisons = measurementComparisonContext(projectId, 10);
  const drop = comparisons.positionDrops[0] ?? comparisons.clickDrops[0];
  if (drop) {
    const query = String((drop as any).query ?? '');
    const keyword = await db.select().from(schema.keywords).where(and(eq(schema.keywords.projectId, projectId), eq(schema.keywords.normalized, query.trim().toLowerCase().replace(/\s+/g, ' ')))).get();
    const latest = (drop as any).latest; const previous = (drop as any).previous;
    candidates.push({ kind: 'investigate_query_drop', rank: 5, title: `Investigate search decline: ${query}`, reason: `Comparable scoped GSC observations changed from position ${previous.position.toFixed(1)} / ${previous.clicks} clicks to ${latest.position.toFixed(1)} / ${latest.clicks} clicks.`, measurement: { sourceVersion: latest.sourceVersion, targetOrigin: latest.targetOrigin, periodDays: (drop as any).periodDays }, relatedType: 'keyword', relatedId: keyword?.id ?? null });
  }

  const dueOutcome = sqlite.prepare("SELECT * FROM operation_outcomes WHERE project_id=? AND outcome_status='pending' AND evaluation_due_at IS NOT NULL AND evaluation_due_at<=? ORDER BY evaluation_due_at LIMIT 1").get(projectId, now()) as any;
  if (dueOutcome) candidates.push({ kind: 'observe_outcome', rank: 5.5, title: 'Evaluate a due operation outcome', reason: `Outcome ${dueOutcome.id} reached its evaluation time ${dueOutcome.evaluation_due_at}.`, relatedType: 'operation_outcome', relatedId: dueOutcome.id });

  if (recovery.applicable) {
    if (recovery.state === 'measurement_due' || (recovery.state === 'measurement_incomplete' && (!recovery.nextObservationAt || recovery.nextObservationAt <= now()))) {
      candidates.push({ kind: 'capture_recovery', rank: 5.6, title: 'Measure index recovery before expanding content',
        reason: 'Capture the same dispersed sample of up to 20 URLs and 21 complete days of host-scoped Search Console visibility. Persist API observations; do not infer a Google quality penalty or write an article for this measurement task.',
        relatedType: 'site', relatedId: projectId });
    } else if (['technical_repair','content_recovery','visibility_decline'].includes(recovery.state)) {
      const target = recovery.targets.find(item => !sqlite.prepare(`SELECT id FROM operation_requests WHERE json_extract(constraints_json,'$.operatorKind')='recover_existing_page'
        AND json_extract(constraints_json,'$.relatedId')=? AND json_extract(constraints_json,'$.observationSourceId')=? LIMIT 1`).get(item.pageId, recovery.latest?.id ?? ''));
      if (target) candidates.push({ kind: 'recover_existing_page', rank: 5.7, title: `Investigate and improve the existing page: ${target.title}`,
        reason: `${target.reason} Read the actual page and the recovery source first. Make one evidence-backed existing-page improvement, or record a specific no-change finding. Keep the URL. New pages are not allowed during recovery.`,
        relatedType: 'page', relatedId: target.pageId, targetUrl: target.url, observationSourceId: recovery.latest?.id });
    }
    if (!recovery.newContentAllowed) candidates.push({ kind: 'observe_recovery', rank: 8.5, title: 'Observe recovery without expanding the site',
      reason: recovery.reasons.join(' '), nextObservationAt: recovery.nextObservationAt, relatedType: 'site', relatedId: projectId });
  }

  const staleMs = 7 * 24 * 60 * 60 * 1000;
  if (project.mode === 'existing_site' && project.domain && (!livePage || !latestSitemap || Date.now() - new Date(latestSitemap.createdAt).getTime() > staleMs)) candidates.push({ kind: 'sync_site', rank: 5.4, title: 'Refresh live site URL inventory', reason: livePage ? 'A fresh live sitemap inventory is required before selecting a recovery sample.' : 'No live site URL inventory has been imported yet.', relatedType: 'site', relatedId: projectId });
  const gscConfigured = Boolean((process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN || process.env.GOOGLE_APPLICATION_CREDENTIALS || (process.env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN || process.env.GOOGLE_OAUTH_REFRESH_TOKEN) && (process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID || process.env.ADS_CLIENT_ID) && (process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.ADS_CLIENT_SECRET)) && process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL);
  if (project.mode === 'existing_site' && gscConfigured && (!latestSnapshot || Date.now() - new Date(latestSnapshot.createdAt).getTime() > staleMs)) candidates.push({ kind: 'capture_metrics', rank: 7, title: 'Capture fresh scoped Search Console metrics', reason: latestSnapshot ? 'The latest GSC observation is older than 7 days.' : 'No scoped historical GSC observation has been captured yet.', relatedType: 'metrics', relatedId: projectId });
  if ((!recovery.applicable || recovery.newContentAllowed) && unclustered[0]?.avgMonthly) candidates.push({ kind: 'structure_demand', rank: 8, title: `Resolve unclustered demand: ${unclustered[0].text}`, reason: `${unclustered[0].avgMonthly} average monthly searches are recorded with no cluster assignment.`, relatedType: 'keyword', relatedId: unclustered[0].id });
  const dueAt = project.lastDiscoveryAt ? new Date(new Date(project.lastDiscoveryAt).getTime() + project.discoveryCadenceDays * 86_400_000) : null;
  if ((!recovery.applicable || recovery.newContentAllowed) && !discovery && (!dueAt || Date.now() >= dueAt.getTime()) && (project.topic || project.domain)) {
    const providerHealthy = !adsCapability || adsCapability.status === 'available';
    if (googleAdsConfigured() && providerHealthy) candidates.push({ kind: 'discovery_due', rank: 9, title: 'Keyword discovery is due', reason: dueAt ? `The ${project.discoveryCadenceDays}-day discovery interval has elapsed.` : 'No completed discovery run has been recorded yet.', relatedType: 'project', relatedId: projectId });
    else candidates.push({ kind: 'await_demand_provider', rank: 9, title: 'Search-volume provider configuration is required', reason: !googleAdsConfigured() ? 'New keyword discovery is paused because Google Ads Keyword Planner credentials or the keyword-volume proxy are not configured. SERP related searches are observations, not search-volume evidence.' : `New keyword discovery is paused because the last Google Ads demand request is ${adsCapability?.status ?? 'unhealthy'}: ${adsCapability?.lastErrorMessage ?? 'repair the provider before retrying.'}`, relatedType: 'provider_capability', relatedId: `${projectId}:google_ads` });
  }
  candidates.sort((a, b) => Number(a.rank) - Number(b.rank));
  return { generatedAt: now(), project: { id: project.id, name: project.name, domain: project.domain, mode: project.mode }, control, recovery: { state: recovery.state, newContentAllowed: recovery.newContentAllowed, reasons: recovery.reasons, summary: recovery.summary, nextObservationAt: recovery.nextObservationAt }, measurement: { ignoredUnknownScope: comparisons.ignoredUnknownScope }, candidates, next: candidates[0] ?? { kind: 'no_action', reason: 'No operator action is currently justified.' } };
}

export const operatorCommands = {
  inspect: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'operator.inspect', { projectId }, async () => inspect(projectId)),
  tick: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'operator.tick', { projectId }, async () => {
    const state = await inspect(projectId); const next = state.next as Record<string, unknown>; const kind = String(next.kind ?? 'no_action');
    if (kind === 'recover_discovery' && next.relatedId) {
      const recovery = await discoveryCommands.recoverExpired({ actor: 'system', actorId: 'operator', projectId }, { projectId, jobId: String(next.relatedId) });
      return { ...(await inspect(projectId)), createdTask: null, recovery };
    }
    if (['no_action','observe_recovery','operation_paused','await_review','await_demand_provider','review_discovery','claim_discovery','resume_discovery','resume_session','existing_task'].includes(kind)) return { ...state, createdTask: null };
    const relatedType = String(next.relatedType ?? kind); const relatedId = next.relatedId ? String(next.relatedId) : null;
    const duplicate = await db.select().from(schema.tasks).where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.assigneeType, 'agent'), ne(schema.tasks.status, 'done'), eq(schema.tasks.relatedType, relatedType), relatedId ? eq(schema.tasks.relatedId, relatedId) : isNull(schema.tasks.relatedId))).get();
    if (duplicate) return { ...state, createdTask: null, existingTaskId: duplicate.id };
    const t = now(); const priority = kind === 'investigate_query_drop' || kind === 'observe_outcome' ? 90 : kind === 'sync_site' || kind === 'capture_metrics' ? 70 : kind === 'discovery_due' ? 55 : 60;
    const task = { id: id(), projectId, title: String(next.title ?? 'Operator-selected SEO task'), description: String(next.reason ?? ''), status: 'todo', priority, assigneeType: 'agent', relatedType, relatedId, createdAt: t, updatedAt: t };
    await db.insert(schema.tasks).values(task); return { ...state, createdTask: task };
  })
};
