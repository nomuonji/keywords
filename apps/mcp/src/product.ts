import type { CommandContext } from '@keywords/domain';
import { recoveryCommands } from '@keywords/commands/recovery';
import { discoveryCommands } from '@keywords/commands/discovery';
import { workspaceCommands } from '@keywords/commands/workspace';
import { workCommands } from '@keywords/commands/work';
import { operationCommands } from '@keywords/commands/operation';
import { operationDiscoveryCommands } from '@keywords/commands/operation-discovery';
import { executorCommands } from '@keywords/commands/executor';
import { measurementCommands } from '@keywords/commands/measurement';
import { metricsCommands } from '@keywords/commands/metrics';

const s = (description: string, properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, description, properties, required });

export const productTools = [
  { name: 'recovery_context', description: 'Read fixed-cohort index recovery, complete weekly visibility, expansion eligibility and up to three existing-page investigation targets.', inputSchema: s('Recovery context', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'recovery_capture', description: 'Capture up to 20 fixed-cohort URL inspections and 21 complete days of scoped GSC visibility. Resumes saved successful inspections; API failures never become deindexation or zero traffic. Requires up to 22 external-request units.', inputSchema: s('Recovery observation', { projectId: { type: 'string' }, siteUrl: { type: 'string' }, endDate: { type: 'string' } }, ['projectId']) },
  { name: 'operation_context', description: 'Read the durable agent-driven operation state, open judgments, executor status, outcomes and project controls.', inputSchema: s('Operation context', { projectId: { type: 'string' }, operationId: { type: 'string' } }) },
  { name: 'operation_start', description: 'Turn one natural-language request into an idempotent bounded shared operation. Requires a human-granted operation.start delegation for agents.', inputSchema: s('Start operation', { requestText: { type: 'string' }, requestKey: { type: 'string' }, conversationRef: { type: 'string' }, objective: { type: 'string' }, projectIds: { type: 'array', items: { type: 'string' } }, scope: { type: 'string', enum: ['single','portfolio'] }, completionCriteria: { type: 'array', items: { type: 'string' } }, constraints: { type: 'object', additionalProperties: true }, permissions: { type: 'object', additionalProperties: true }, assumptions: { type: 'array', items: { type: 'string' } }, budget: { type: 'object', additionalProperties: true } }, ['requestText']) },
  { name: 'operation_resume', description: 'Resume an existing operation after a blocker or resolved review without creating duplicate work.', inputSchema: s('Resume operation', { operationId: { type: 'string' }, projectId: { type: 'string' } }, ['operationId']) },
  { name: 'operation_cancel', description: 'Cancel a stale or no-longer-needed operation and close its shared work, tasks and executor claims. Human actor only.', inputSchema: s('Cancel operation', { operationId: { type: 'string' }, reason: { type: 'string' } }, ['operationId','reason']) },
  { name: 'operation_checkpoint', description: 'Persist only an auditable outcome/blocker/next action for one project in an operation.', inputSchema: s('Operation checkpoint', { operationId: { type: 'string' }, projectId: { type: 'string' }, state: { type: 'string', enum: ['working','awaiting_review','blocked'] }, summary: { type: 'string' }, nextAction: { type: 'string' } }, ['operationId','projectId','state','summary']) },
  { name: 'operation_complete', description: 'Complete the parent operation and its attached shared work/tasks.', inputSchema: s('Complete operation', { operationId: { type: 'string' }, summary: { type: 'string' } }, ['operationId','summary']) },
  { name: 'operation_discovery_start', description: 'Start and atomically claim normal keyword discovery from an active operation under delegated limits. Search-volume demand is required by default; use surface_only only for an explicitly observation-only run.', inputSchema: s('Operation discovery', { operationId: { type: 'string' }, projectId: { type: 'string' }, seedKeywords: { type: 'array', items: { type: 'string' } }, targetUrl: { type: 'string' }, goal: { type: 'string' }, language: { type: 'string' }, country: { type: 'string' }, region: { type: 'string' }, excludedTerms: { type: 'array', items: { type: 'string' } }, demandPolicy: { type: 'string', enum: ['required','surface_only'] }, maxCandidates: { type: 'number' }, maxExternalRequests: { type: 'number' }, leaseSeconds: { type: 'number' } }, ['operationId','projectId','goal']) },
  { name: 'operation_candidate_triage', description: 'Apply explicitly delegated candidate shortlist/hold/reject/research-more decisions and record them as decisions.', inputSchema: s('Candidate triage', { operationId: { type: 'string' }, projectId: { type: 'string' }, jobId: { type: 'string' }, candidateIds: { type: 'array', items: { type: 'string' } }, status: { type: 'string', enum: ['shortlisted','hold','rejected','research_more'] }, reason: { type: 'string' } }, ['operationId','projectId','jobId','candidateIds','status','reason']) },
  { name: 'operation_blog_handoff', description: 'Return an approved Blog handoff directly as structured command output; publication remains unauthorized.', inputSchema: s('Blog handoff', { operationId: { type: 'string' }, projectId: { type: 'string' }, pageId: { type: 'string' } }, ['operationId','projectId','pageId']) },
  { name: 'operation_outcome_record', description: 'Record an observed operation outcome, attribution caveat and next action.', inputSchema: s('Outcome', { operationId: { type: 'string' }, projectId: { type: 'string' }, targetUrl: { type: 'string' }, handoffId: { type: 'string' }, hypothesis: { type: 'string' }, implementedAt: { type: 'string' }, publishedAt: { type: 'string' }, evaluationDueAt: { type: 'string' }, status: { type: 'string', enum: ['pending','improved','regressed','inconclusive','unmeasurable'] }, metrics: { type: 'object', additionalProperties: true }, attributionNotes: { type: 'string' }, nextAction: { type: 'string' } }, ['projectId','status']) },
  { name: 'operation_outcomes', description: 'List durable outcome observations for follow-up and learning.', inputSchema: s('Outcomes', { projectId: { type: 'string' }, status: { type: 'string' }, limit: { type: 'number' } }) },
  { name: 'executor_register', description: 'Register or restart this persistent executor and obtain a new generation-fenced lease.', inputSchema: s('Executor register', { executorId: { type: 'string' }, capabilities: { type: 'array', items: { type: 'string' } }, leaseSeconds: { type: 'number' } }) },
  { name: 'executor_heartbeat', description: 'Renew a persistent executor lease using the current generation.', inputSchema: s('Executor heartbeat', { executorId: { type: 'string' }, generation: { type: 'number' }, leaseSeconds: { type: 'number' } }, ['generation']) },
  { name: 'executor_claim', description: 'Generation-fenced claim of one project in an operation by this executor.', inputSchema: s('Executor claim', { executorId: { type: 'string' }, generation: { type: 'number' }, operationId: { type: 'string' }, projectId: { type: 'string' }, leaseSeconds: { type: 'number' } }, ['generation','operationId','projectId']) },
  { name: 'executor_claim_next', description: 'Claim the highest-priority eligible operation project without creating a duplicate job.', inputSchema: s('Executor claim next', { executorId: { type: 'string' }, generation: { type: 'number' }, projectId: { type: 'string' }, leaseSeconds: { type: 'number' } }, ['generation']) },
  { name: 'executor_release', description: 'Release a claimed operation project only if executor generation and ownership still match.', inputSchema: s('Executor release', { executorId: { type: 'string' }, generation: { type: 'number' }, operationId: { type: 'string' }, projectId: { type: 'string' } }, ['generation','operationId','projectId']) },
  { name: 'executor_list', description: 'List executor connection, generation and lease state.', inputSchema: s('Executor list', {}) },
  { name: 'executor_recover_stale', description: 'Recover expired executor claims. Intended for a system actor; human recovery is available through CLI/HTTP.', inputSchema: s('Recover stale executors', { before: { type: 'string' } }) },
  { name: 'measurement_context', description: 'Read only comparable complete observations under the shared provider/property/origin/filter/timezone contract.', inputSchema: s('Measurement context', { projectId: { type: 'string' }, limit: { type: 'number' } }, ['projectId']) },
  { name: 'measurement_capture', description: 'Capture scoped Search Console query/page observations. Partial/failed observations never overwrite the last complete materialization.', inputSchema: s('Measurement capture', { projectId: { type: 'string' }, siteUrl: { type: 'string' }, targetOrigin: { type: 'string' }, startDate: { type: 'string' }, endDate: { type: 'string' }, searchType: { type: 'string' }, timezone: { type: 'string' }, rowLimit: { type: 'number' } }, ['projectId','startDate','endDate']) },
  { name: 'measurement_import', description: 'Import a versioned collector observation into the same measurement contract used by Keywords.', inputSchema: s('Measurement import', { projectId: { type: 'string' }, provider: { type: 'string' }, property: { type: 'string' }, targetOrigin: { type: 'string' }, filters: { type: 'array', items: { type: 'object', additionalProperties: true } }, startDate: { type: 'string' }, endDate: { type: 'string' }, timezone: { type: 'string' }, searchType: { type: 'string' }, dimensions: { type: 'array', items: { type: 'string' } }, status: { type: 'string', enum: ['succeeded','partial','failed'] }, completeness: { type: 'string', enum: ['complete','partial','unknown','failed'] }, sourceLabel: { type: 'string' }, sourceVersion: { type: 'string' }, capturedAt: { type: 'string' }, payload: { type: 'object', additionalProperties: true } }, ['projectId','provider','property','startDate','endDate','dimensions','status','completeness','sourceLabel','sourceVersion','capturedAt']) },
  { name: 'remote_readiness', description: 'Explain whether the current persistence/auth/executor configuration is eligible for an always-on remote host.', inputSchema: s('Remote readiness', {}) },

  { name: 'project_brief', description: 'Read the human-defined project brief: mode, topic, audience, language, region and discovery limits.', inputSchema: s('Project brief', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'project_capabilities', description: 'Read configured research capabilities and last provider health without exposing credentials.', inputSchema: s('Capabilities', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'workspace_keyword_search', description: 'Search/paginate/filter/sort the keyword workspace without loading every keyword into the client.', inputSchema: s('Keyword search', { projectId: { type: 'string' }, q: { type: 'string' }, candidateStatus: { type: 'string' }, clusterId: { type: 'string' }, existingPage: { type: 'string', enum: ['with','without'] }, researchStatus: { type: 'string', enum: ['researched','unresearched','failed'] }, provider: { type: 'string' }, sort: { type: 'string', enum: ['demand_desc','keyword_asc','gsc_impressions_desc','updated_desc'] }, limit: { type: 'number' }, offset: { type: 'number' } }, ['projectId']) },
  { name: 'workspace_keyword_detail', description: 'Read one keyword with discovery history, evidence, GSC snapshots, cluster, pages and human decisions.', inputSchema: s('Keyword detail', { projectId: { type: 'string' }, keywordId: { type: 'string' } }, ['projectId','keywordId']) },
  { name: 'evidence_for_target', description: 'Read evidence sources explicitly linked to a discovery candidate or page plan.', inputSchema: s('Evidence', { projectId: { type: 'string' }, targetType: { type: 'string' }, targetId: { type: 'string' } }, ['projectId','targetType','targetId']) },
  { name: 'continuous_discovery_context', description: 'Read discovery cadence, outcome learning, rejection/hold reasons, provider performance and suggested next-run adjustments.', inputSchema: s('Continuous discovery', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'discovery_list', description: 'List discovery jobs and candidate decision counts.', inputSchema: s('Discovery jobs', { projectId: { type: 'string' }, limit: { type: 'number' } }, ['projectId']) },
  { name: 'discovery_context', description: 'Read one discovery job with candidates, executor lease, atomic budgets, outcome summary, evidence counts and unresolved questions.', inputSchema: s('Discovery job', { projectId: { type: 'string' }, jobId: { type: 'string' } }, ['projectId','jobId']) },
  { name: 'discovery_claim', description: 'Claim a legacy human-created waiting discovery job. New agent-driven discovery should use operation_discovery_start.', inputSchema: s('Claim discovery', { projectId: { type: 'string' }, jobId: { type: 'string' }, leaseSeconds: { type: 'number' } }, ['projectId','jobId']) },
  { name: 'discovery_heartbeat', description: 'Renew the current executor lease while actively working a claimed discovery job.', inputSchema: s('Discovery heartbeat', { projectId: { type: 'string' }, jobId: { type: 'string' }, leaseSeconds: { type: 'number' } }, ['projectId','jobId']) },
  { name: 'discovery_import_candidates', description: 'Import bounded candidate observations gathered by the claiming agent.', inputSchema: s('Import candidates', { projectId: { type: 'string' }, jobId: { type: 'string' }, candidates: { type: 'array', items: { type: 'object', properties: { keyword: { type: 'string' }, demandValue: { type: 'number' }, demandProvider: { type: 'string' }, observedAt: { type: 'string' }, adCompetition: { type: 'number' }, sourceId: { type: 'string' } }, required: ['keyword'] } } }, ['projectId','jobId','candidates']) },
  { name: 'discovery_ads_ideas', description: 'Reserve one discovery external-request unit for Google Ads ideas. Advertising competition is not SEO difficulty.', inputSchema: s('Ads discovery', { projectId: { type: 'string' }, jobId: { type: 'string' }, seedKeywords: { type: 'array', items: { type: 'string' } }, url: { type: 'string' }, languageId: { type: 'string' }, geoTargetIds: { type: 'array', items: { type: 'string' } }, idempotencyKey: { type: 'string' } }, ['projectId','jobId']) },
  { name: 'discovery_serp', description: 'Reserve one discovery external-request unit to capture SERP evidence for a candidate.', inputSchema: s('SERP candidate research', { projectId: { type: 'string' }, jobId: { type: 'string' }, candidateId: { type: 'string' }, num: { type: 'number' }, idempotencyKey: { type: 'string' } }, ['projectId','jobId','candidateId']) },
  { name: 'discovery_web_evidence', description: 'Reserve one discovery external-request unit to link a public-web source to a candidate.', inputSchema: s('Web candidate evidence', { projectId: { type: 'string' }, jobId: { type: 'string' }, candidateId: { type: 'string' }, url: { type: 'string' }, idempotencyKey: { type: 'string' } }, ['projectId','jobId','candidateId','url']) },
  { name: 'discovery_annotate', description: 'Store a concise search-intent hypothesis and unresolved questions for one candidate.', inputSchema: s('Candidate annotation', { projectId: { type: 'string' }, jobId: { type: 'string' }, candidateId: { type: 'string' }, searchIntent: { type: 'string' }, unresolvedQuestions: { type: 'array', items: { type: 'string' } } }, ['projectId','jobId','candidateId']) },
  { name: 'discovery_finish_research', description: 'Finish the agent research phase and hand candidates to review.', inputSchema: s('Finish discovery research', { projectId: { type: 'string' }, jobId: { type: 'string' }, summary: { type: 'string' } }, ['projectId','jobId','summary']) }
];

const names = new Set(productTools.map(tool => tool.name));
export const isProductTool = (name: string) => names.has(name);

export async function callProductTool(name: string, a: any, ctx: CommandContext) {
  switch (name) {
    case 'recovery_context': return recoveryCommands.context(ctx, a);
    case 'recovery_capture': return recoveryCommands.capture(ctx, a);
    case 'operation_context': return operationCommands.context(ctx, a);
    case 'operation_start': {
      const result = await operationCommands.start(ctx, a);
      const first = (result as any)?.children?.[0];
      if (!first?.workSessionId) return result;
      const work = await workCommands.context({ ...ctx, workSessionId: first.workSessionId }, { projectId: first.projectId, sessionId: first.workSessionId });
      return { ...result, session: work.session, activeProjectId: first.projectId };
    }
    case 'operation_resume': {
      const result = await operationCommands.resume(ctx, a);
      const child = (result as any).projects?.find((item: any) => !a.projectId || item.projectId === a.projectId);
      if (!child?.workSessionId) return result;
      const work = await workCommands.context({ ...ctx, workSessionId: child.workSessionId }, { projectId: child.projectId, sessionId: child.workSessionId });
      return { ...result, session: work.session, activeProjectId: child.projectId };
    }
    case 'operation_cancel': return operationCommands.cancel(ctx, a);
    case 'operation_checkpoint': return operationCommands.checkpoint(ctx, a);
    case 'operation_complete': return operationCommands.complete(ctx, a);
    case 'operation_discovery_start': {
      const result = await operationDiscoveryCommands.startAndClaim(ctx, a);
      const work = (result as any).workSessionId ? await workCommands.context({ ...ctx, workSessionId: (result as any).workSessionId }, { projectId: a.projectId, sessionId: (result as any).workSessionId }) : null;
      return { ...result, session: work?.session ?? null };
    }
    case 'operation_candidate_triage': return operationCommands.triageCandidates(ctx, a);
    case 'operation_blog_handoff': return operationCommands.prepareBlogHandoff(ctx, a);
    case 'operation_outcome_record': return operationCommands.recordOutcome(ctx, a);
    case 'operation_outcomes': return operationCommands.listOutcomes(ctx, a);
    case 'executor_register': return operationCommands.executorRegister(ctx, a);
    case 'executor_heartbeat': return operationCommands.executorHeartbeat(ctx, a);
    case 'executor_claim': return operationCommands.executorClaim(ctx, a);
    case 'executor_claim_next': return executorCommands.claimNext(ctx, a);
    case 'executor_release': return operationCommands.executorRelease(ctx, a);
    case 'executor_list': return executorCommands.list(ctx);
    case 'executor_recover_stale': return executorCommands.recoverStale(ctx, a);
    case 'measurement_context': return measurementCommands.context(ctx, a.projectId, a.limit);
    case 'measurement_capture': return metricsCommands.capture(ctx, a);
    case 'measurement_import': return measurementCommands.import(ctx, a);
    case 'remote_readiness': return operationCommands.remoteReadiness(ctx);
    case 'project_brief': return workspaceCommands.brief(ctx, a.projectId);
    case 'project_capabilities': return workspaceCommands.capabilities(ctx, a.projectId);
    case 'workspace_keyword_search': return workspaceCommands.keywordSearch(ctx, a);
    case 'workspace_keyword_detail': return workspaceCommands.keywordDetail(ctx, a);
    case 'evidence_for_target': return workspaceCommands.evidence(ctx, a);
    case 'continuous_discovery_context': return workspaceCommands.continuousSummary(ctx, a.projectId);
    case 'discovery_list': return discoveryCommands.list(ctx, a.projectId, a.limit);
    case 'discovery_context': return discoveryCommands.detail(ctx, a);
    case 'discovery_claim': {
      const claim = await discoveryCommands.claim(ctx, a);
      const context = await workCommands.context({ ...ctx, workSessionId: claim.workSessionId }, { projectId: a.projectId, sessionId: claim.workSessionId });
      return { ...claim, session: context.session };
    }
    case 'discovery_heartbeat': return discoveryCommands.heartbeat(ctx, a);
    case 'discovery_import_candidates': return discoveryCommands.importCandidates(ctx, a);
    case 'discovery_ads_ideas': return discoveryCommands.adsIdeas(ctx, a);
    case 'discovery_serp': return discoveryCommands.serp(ctx, a);
    case 'discovery_web_evidence': return discoveryCommands.webEvidence(ctx, a);
    case 'discovery_annotate': return discoveryCommands.annotate(ctx, a);
    case 'discovery_finish_research': return discoveryCommands.finishResearch(ctx, a);
    default: throw new Error(`Unknown product tool: ${name}`);
  }
}
