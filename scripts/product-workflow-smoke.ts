import { commands } from '@keywords/commands';
import { workspaceCommands } from '@keywords/commands/workspace';
import { discoveryCommands } from '@keywords/commands/discovery';
import { planningCommands } from '@keywords/commands/planning';
import { databaseDiagnostics } from '@keywords/db';

const human = { actor: 'human' as const, actorId: 'product-smoke-human' };
const agent = { actor: 'agent' as const, actorId: 'product-smoke-agent' };

const project = await commands.project.create(human, { name: 'Product Workflow Smoke' });
const brief = await workspaceCommands.updateBrief(human, { projectId: project.id, mode: 'topic_only', topic: 'SEO automation', audience: 'independent web publishers', language: 'ja', country: 'jp', excludedTerms: ['求人'], discoveryCadenceDays: 7, discoveryMaxCandidates: 20, discoveryMaxExternalRequests: 4 });
if (brief.topic !== 'SEO automation' || brief.mode !== 'topic_only') throw new Error('Project brief update failed');

const started = await discoveryCommands.start(human, { projectId: project.id, seedKeywords: ['seo 自動化'], goal: 'Find a decision-ready article opportunity' });
if (started.job.status !== 'waiting_for_agent') throw new Error('Discovery did not enter waiting_for_agent');
const claimed = await discoveryCommands.claim(agent, { projectId: project.id, jobId: started.job.id });
if (claimed.status !== 'running' || !claimed.workSessionId) throw new Error('Discovery claim failed');
const agentSession = { ...agent, projectId: project.id, workSessionId: claimed.workSessionId };
await discoveryCommands.importCandidates(agentSession, { projectId: project.id, jobId: started.job.id, candidates: [
  { keyword: 'seo 自動化 方法', demandValue: 120, demandProvider: 'smoke', observedAt: new Date().toISOString(), adCompetition: 0.35 },
  { keyword: '求人 seo', demandValue: 999, demandProvider: 'smoke', observedAt: new Date().toISOString(), adCompetition: 0.1 }
] });
let detail = await discoveryCommands.detail(agentSession, { projectId: project.id, jobId: started.job.id });
if (detail.candidates.length !== 1) throw new Error('Candidate cap/exclusion/dedupe flow failed');
const candidate = detail.candidates[0];
await discoveryCommands.annotate(agentSession, { projectId: project.id, jobId: started.job.id, candidateId: candidate.id, searchIntent: 'informational', unresolvedQuestions: ['SERP evidence still needed in production'] });
await discoveryCommands.finishResearch(agentSession, { projectId: project.id, jobId: started.job.id, summary: 'Prepared one candidate with explicit unresolved evidence.' });
await discoveryCommands.reviewCandidate(human, { projectId: project.id, jobId: started.job.id, candidateId: candidate.id, status: 'shortlisted', reason: 'Fits the project brief.' });
detail = await discoveryCommands.detail(human, { projectId: project.id, jobId: started.job.id });
if (detail.job.status !== 'completed' || detail.candidates[0].status !== 'shortlisted') throw new Error('Human discovery review did not complete');
if (!candidate.keywordId) throw new Error('Candidate keyword was not linked');

const cluster = await commands.cluster.create(agent, { projectId: project.id, title: 'SEO automation methods', intent: 'informational' });
await planningCommands.clusterBulkAssign(agent, { projectId: project.id, clusterId: cluster.id, keywordIds: [candidate.keywordId] });
const source = await commands.source.record(agent, { projectId: project.id, type: 'smoke', label: 'Smoke planning evidence', metadata: { verified: true } });
const planned = await planningCommands.pagePlan(agent, { projectId: project.id, title: 'SEO automation methods guide', clusterId: cluster.id, primaryKeywordId: candidate.keywordId, sourceIds: [source.id], audience: 'independent web publishers', question: 'How can SEO research be automated safely?', searchIntent: 'informational', uniqueAngle: 'Bounded human-governed agent workflow', unresolvedAssumptions: ['Validate live SERP before publication'], rationale: 'Shortlisted candidate with explicit planning evidence.' });
const targets = await planningCommands.pageTargets(human, { projectId: project.id, pageId: planned.page.id });
if (targets.targets.length !== 1 || targets.evidence.length !== 1) throw new Error('Planning evidence links failed');
const reviewed = await planningCommands.pageReview(human, { projectId: project.id, pageId: planned.page.id, verdict: 'approved' });
if (reviewed.status !== 'approved') throw new Error('Human page approval failed');

const keywordWorkspace = await workspaceCommands.keywordSearch(human, { projectId: project.id, candidateStatus: 'shortlisted', limit: 10, offset: 0 });
if (keywordWorkspace.total !== 1) throw new Error('Keyword workspace candidate filtering failed');
const continuous = await workspaceCommands.continuousSummary(human, project.id);
if (continuous.jobs !== 1 || continuous.candidateCounts.shortlisted !== 1) throw new Error('Continuous discovery summary failed');
if (databaseDiagnostics().quickCheck !== 'ok') throw new Error('Database integrity check failed');
console.log(JSON.stringify({ ok: true, projectId: project.id, discoveryJobId: started.job.id, pageId: planned.page.id }, null, 2));
