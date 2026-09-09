import { commands } from '@keywords/commands';
import { workspaceCommands } from '@keywords/commands/workspace';
import { discoveryCommands } from '@keywords/commands/discovery';
import { planningCommands } from '@keywords/commands/planning';
import { providerSeedKeywords } from '@keywords/commands/discovery-policy';
import { databaseDiagnostics, getDatabase } from '@keywords/db';

const human = { actor: 'human' as const, actorId: 'product-smoke-human' };
const agent = { actor: 'agent' as const, actorId: 'product-smoke-agent' };
const otherAgent = { actor: 'agent' as const, actorId: 'product-smoke-other-agent' };
const expectFailure = async (fn: () => Promise<unknown>, message: string) => { let failed = false; try { await fn(); } catch { failed = true; } if (!failed) throw new Error(message); };
if (JSON.stringify(providerSeedKeywords(['SEO 自動化'])) !== JSON.stringify(['SEO 自動化', 'SEO'])) throw new Error('Provider lexical seed expansion failed');

const project = await commands.project.create(human, { name: 'Product Workflow Smoke' });
const brief = await workspaceCommands.updateBrief(human, { projectId: project.id, mode: 'topic_only', topic: 'SEO automation', audience: 'independent web publishers', language: 'ja', country: 'jp', excludedTerms: ['求人'], discoveryCadenceDays: 7, discoveryMaxCandidates: 3, discoveryMaxExternalRequests: 2 });
if (brief.topic !== 'SEO automation' || brief.mode !== 'topic_only') throw new Error('Project brief update failed');

const known = await commands.keyword.create(human, { projectId: project.id, text: 'seo 自動化 既知', source: 'manual' });
const evidence = await commands.source.record(agent, { projectId: project.id, type: 'google_ads', label: 'Smoke Google Ads demand evidence', metadata: { verified: true } });
const demandEnvKeys = ['GOOGLE_ADS_ACCESS_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_ADS_DEVELOPER_TOKEN','ADS_DEVELOPER_TOKEN','GOOGLE_ADS_CUSTOMER_ID','ADS_CUSTOMER_ID','GOOGLE_ADS_REFRESH_TOKEN','ADS_REFRESH_TOKEN','GOOGLE_ADS_CLIENT_ID','ADS_CLIENT_ID','GOOGLE_ADS_CLIENT_SECRET','ADS_CLIENT_SECRET','GOOGLE_ADS_KEYWORD_VOLUME_API_URL','KEYWORD_VOLUME_API_URL'];
const savedDemandEnv = new Map(demandEnvKeys.map(key => [key, process.env[key]]));
const tasksBeforeMissingProvider = Number((getDatabase().sqlite.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n);
for (const key of demandEnvKeys) delete process.env[key];
await expectFailure(() => discoveryCommands.start(human, { projectId: project.id, seedKeywords: ['provider gate'], goal: 'must not queue without provider', demandPolicy: 'required' }), 'Missing provider unexpectedly queued a discovery task');
const tasksAfterMissingProvider = Number((getDatabase().sqlite.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n);
if (tasksAfterMissingProvider !== tasksBeforeMissingProvider) throw new Error('Missing provider left an orphan discovery task');
for (const [key, value] of savedDemandEnv) if (value === undefined) delete process.env[key]; else process.env[key] = value;
const started = await discoveryCommands.start(human, { projectId: project.id, seedKeywords: ['seo 自動化'], goal: 'Find decision-ready article opportunities', demandPolicy: 'surface_only', maxCandidates: 3, maxExternalRequests: 2 });
if (started.job.status !== 'waiting_for_agent') throw new Error('Discovery did not enter waiting_for_agent');
const claimed = await discoveryCommands.claim(agent, { projectId: project.id, jobId: started.job.id, leaseSeconds: 60 });
if (claimed.status !== 'running' || !claimed.workSessionId || claimed.executorId !== agent.actorId) throw new Error('Discovery claim failed');
await expectFailure(() => discoveryCommands.claim(otherAgent, { projectId: project.id, jobId: started.job.id }), 'Second executor unexpectedly claimed a running discovery job');
const heartbeat = await discoveryCommands.heartbeat(agent, { projectId: project.id, jobId: started.job.id, leaseSeconds: 60 });
if (!heartbeat.leaseExpiresAt) throw new Error('Discovery heartbeat failed');
const agentSession = { ...agent, projectId: project.id, workSessionId: claimed.workSessionId };
const imported = await discoveryCommands.importCandidates(agentSession, { projectId: project.id, jobId: started.job.id, candidates: [
  { keyword: '求人 seo', demandValue: 999, demandProvider: 'google_ads', observedAt: new Date().toISOString(), sourceId: evidence.id },
  { keyword: known.text, demandValue: 80, demandProvider: 'google_ads', observedAt: new Date().toISOString(), sourceId: evidence.id },
  { keyword: 'seo 自動化 方法', demandValue: 120, demandProvider: 'google_ads', observedAt: new Date().toISOString(), adCompetition: 0.35, sourceId: evidence.id },
  { keyword: 'seo 自動化 ツール', demandValue: 90, demandProvider: 'google_ads', observedAt: new Date().toISOString(), sourceId: evidence.id },
  { keyword: 'seo 自動化 上限外', demandValue: 70, demandProvider: 'google_ads', observedAt: new Date().toISOString(), sourceId: evidence.id }
] });
if (imported.created !== 3 || !imported.capped || imported.rejectedByRule !== 1 || imported.alreadyKnown !== 1 || imported.newlyDiscovered !== 2) throw new Error(`Candidate cap/origin/exclusion flow failed: ${JSON.stringify(imported)}`);
const cappedKeywordLeak = await workspaceCommands.keywordSearch(human, { projectId: project.id, q: 'seo 自動化 上限外', limit: 10, offset: 0 });
if (cappedKeywordLeak.total !== 0) throw new Error('Candidate cap leaked an unaccepted keyword into the workspace');
let detail = await discoveryCommands.detail(agentSession, { projectId: project.id, jobId: started.job.id });
if (detail.candidates.length !== 3 || detail.progress.candidateWrites.used !== 3 || detail.progress.rejectedByRule !== 1) throw new Error('Discovery progress summary failed');
const duplicateSeed = await discoveryCommands.importCandidates(agentSession, { projectId: project.id, jobId: started.job.id, candidates: [{ keyword: 'seo 自動化', demandValue: 200, demandProvider: 'google_ads', observedAt: new Date().toISOString(), sourceId: evidence.id }] });
if (duplicateSeed.created !== 0 || duplicateSeed.rejectedByRule !== 1) throw new Error('Seed phrase was incorrectly accepted as a new candidate');
const primaryCandidate = detail.candidates.find(c => c.keyword === 'seo 自動化 方法');
const knownCandidate = detail.candidates.find(c => c.keyword === known.text);
const toolCandidate = detail.candidates.find(c => c.keyword === 'seo 自動化 ツール');
if (!primaryCandidate?.keywordId || !knownCandidate || !toolCandidate) throw new Error('Expected discovery candidates were not linked');

await expectFailure(() => discoveryCommands.webEvidence(agentSession, { projectId: project.id, jobId: started.job.id, candidateId: primaryCandidate.id, url: 'http://127.0.0.1/private', idempotencyKey: 'blocked-web-1' }), 'Private web evidence unexpectedly succeeded');
detail = await discoveryCommands.detail(agentSession, { projectId: project.id, jobId: started.job.id });
if (detail.progress.requests.used !== 1 || detail.progress.failedObservations !== 1) throw new Error('Failed external request was not reserved/countable');
await expectFailure(() => discoveryCommands.webEvidence(agentSession, { projectId: project.id, jobId: started.job.id, candidateId: primaryCandidate.id, url: 'http://127.0.0.1/private', idempotencyKey: 'blocked-web-1' }), 'Failed idempotency key unexpectedly retried');
detail = await discoveryCommands.detail(agentSession, { projectId: project.id, jobId: started.job.id });
if (detail.progress.requests.used !== 1) throw new Error('Repeated idempotency key double-consumed external budget');
await expectFailure(() => discoveryCommands.webEvidence(agentSession, { projectId: project.id, jobId: started.job.id, candidateId: primaryCandidate.id, url: 'http://127.0.0.1/private', idempotencyKey: 'blocked-web-2' }), 'Second private web evidence unexpectedly succeeded');
await expectFailure(() => discoveryCommands.webEvidence(agentSession, { projectId: project.id, jobId: started.job.id, candidateId: primaryCandidate.id, url: 'http://127.0.0.1/private', idempotencyKey: 'blocked-web-3' }), 'External request budget was not enforced');
detail = await discoveryCommands.detail(agentSession, { projectId: project.id, jobId: started.job.id });
if (detail.progress.requests.used !== 2 || detail.progress.failedObservations !== 2) throw new Error('Atomic external request budget failed');

await discoveryCommands.annotate(agentSession, { projectId: project.id, jobId: started.job.id, candidateId: primaryCandidate.id, searchIntent: 'informational', unresolvedQuestions: ['SERP evidence intentionally unavailable in smoke'] });
await discoveryCommands.finishResearch(agentSession, { projectId: project.id, jobId: started.job.id, summary: 'Prepared three bounded candidates with explicit external-observation failures.' });
await discoveryCommands.reviewCandidate(human, { projectId: project.id, jobId: started.job.id, candidateId: primaryCandidate.id, status: 'shortlisted', reason: 'Fits the project brief.' });
await discoveryCommands.bulkReviewCandidates(human, { projectId: project.id, candidateIds: [knownCandidate.id], status: 'hold', reason: 'Already covered by existing knowledge.' });
await discoveryCommands.bulkReviewCandidates(human, { projectId: project.id, candidateIds: [toolCandidate.id], status: 'rejected', reason: 'Too tool-specific for this project.' });
detail = await discoveryCommands.detail(human, { projectId: project.id, jobId: started.job.id });
if (detail.job.status !== 'completed') throw new Error('Human discovery review did not complete');

const filtered = await workspaceCommands.keywordSearch(human, { projectId: project.id, candidateStatus: 'shortlisted', provider: 'google_ads', existingPage: 'without', researchStatus: 'researched', sort: 'keyword_asc', limit: 10, offset: 0 });
if (filtered.total !== 1 || filtered.items[0].keyword.id !== primaryCandidate.keywordId) throw new Error('Keyword workspace filtering failed');
const keywordDetail = await workspaceCommands.keywordDetail(human, { projectId: project.id, keywordId: primaryCandidate.keywordId });
if (!keywordDetail.candidates.length || !keywordDetail.evidence.length || !keywordDetail.decisions.some(d => d.verdict === 'shortlisted')) throw new Error('Keyword detail history/evidence failed');

const cluster = await commands.cluster.create(agent, { projectId: project.id, title: 'SEO automation methods', intent: 'informational' });
await planningCommands.clusterBulkAssign(agent, { projectId: project.id, clusterId: cluster.id, keywordIds: [primaryCandidate.keywordId] });
const planned = await planningCommands.pagePlan(agent, { projectId: project.id, title: 'SEO automation methods guide', clusterId: cluster.id, primaryKeywordId: primaryCandidate.keywordId, sourceIds: [evidence.id], audience: 'independent web publishers', question: 'How can SEO research be automated safely?', searchIntent: 'informational', uniqueAngle: 'Bounded human-governed agent workflow', unresolvedAssumptions: ['Validate live SERP before publication'], rationale: 'Shortlisted candidate with explicit planning evidence.' });
const targets = await planningCommands.pageTargets(human, { projectId: project.id, pageId: planned.page.id });
if (targets.targets.length !== 1 || targets.evidence.length !== 1 || targets.approvalImpact.publishingSideEffect !== false || targets.page.unresolvedAssumptions.length !== 1) throw new Error('Planning review context failed');
const afterPlan = await workspaceCommands.keywordSearch(human, { projectId: project.id, candidateStatus: 'planned', limit: 10, offset: 0 });
if (afterPlan.total !== 1) throw new Error('Planned discovery state was not linked from page plan');
const reviewed = await planningCommands.pageReview(human, { projectId: project.id, pageId: planned.page.id, verdict: 'approved' });
if (reviewed.status !== 'approved') throw new Error('Human page approval failed');

const continuous = await workspaceCommands.continuousSummary(human, project.id);
if (continuous.jobs !== 1 || continuous.candidateCounts.planned !== 1 || continuous.candidateCounts.hold !== 1 || continuous.candidateCounts.rejected !== 1) throw new Error('Continuous discovery counts failed');
if (!continuous.learning.rejectReasons.some(x => x.reason.includes('tool-specific')) || !continuous.learning.holdReasons.length || !continuous.learning.providerPerformance.some(x => x.provider === 'google_ads')) throw new Error('Continuous discovery learning failed');

const recoveryProject = await commands.project.create(human, { name: 'Lease Recovery Smoke' });
await workspaceCommands.updateBrief(human, { projectId: recoveryProject.id, mode: 'topic_only', topic: 'lease recovery', language: 'ja', country: 'jp' });
const recoveryJob = await discoveryCommands.start(human, { projectId: recoveryProject.id, seedKeywords: ['lease recovery'], goal: 'Test executor recovery', demandPolicy: 'surface_only' });
await discoveryCommands.claim(agent, { projectId: recoveryProject.id, jobId: recoveryJob.job.id, leaseSeconds: 60 });
getDatabase().sqlite.prepare("UPDATE discovery_jobs SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(recoveryJob.job.id);
const recovered = await discoveryCommands.recoverExpired(human, { projectId: recoveryProject.id, jobId: recoveryJob.job.id });
if (!recovered.recovered || recovered.status !== 'waiting_for_agent') throw new Error('Expired discovery executor was not recovered');

if (databaseDiagnostics().quickCheck !== 'ok') throw new Error('Database integrity check failed');
console.log(JSON.stringify({ ok: true, projectId: project.id, discoveryJobId: started.job.id, pageId: planned.page.id, recoveryJobId: recoveryJob.job.id }, null, 2));
