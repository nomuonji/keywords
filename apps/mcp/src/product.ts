import type { CommandContext } from '@keywords/domain';
import { discoveryCommands } from '@keywords/commands/discovery';
import { workspaceCommands } from '@keywords/commands/workspace';
import { workCommands } from '@keywords/commands/work';

const s = (description: string, properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, description, properties, required });

export const productTools = [
  { name: 'project_brief', description: 'Read the human-defined project brief: mode, topic, audience, language, region and discovery limits.', inputSchema: s('Project brief', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'project_capabilities', description: 'Read configured research capabilities and last provider health without exposing credentials.', inputSchema: s('Capabilities', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'workspace_keyword_search', description: 'Search/paginate/filter/sort the keyword workspace without loading every keyword into the client.', inputSchema: s('Keyword search', { projectId: { type: 'string' }, q: { type: 'string' }, candidateStatus: { type: 'string' }, clusterId: { type: 'string' }, existingPage: { type: 'string', enum: ['with','without'] }, researchStatus: { type: 'string', enum: ['researched','unresearched','failed'] }, provider: { type: 'string' }, sort: { type: 'string', enum: ['demand_desc','keyword_asc','gsc_impressions_desc','updated_desc'] }, limit: { type: 'number' }, offset: { type: 'number' } }, ['projectId']) },
  { name: 'workspace_keyword_detail', description: 'Read one keyword with discovery history, evidence, GSC snapshots, cluster, pages and human decisions.', inputSchema: s('Keyword detail', { projectId: { type: 'string' }, keywordId: { type: 'string' } }, ['projectId','keywordId']) },
  { name: 'evidence_for_target', description: 'Read evidence sources explicitly linked to a discovery candidate or page plan.', inputSchema: s('Evidence', { projectId: { type: 'string' }, targetType: { type: 'string' }, targetId: { type: 'string' } }, ['projectId','targetType','targetId']) },
  { name: 'continuous_discovery_context', description: 'Read discovery cadence, outcome learning, rejection/hold reasons, provider performance and suggested next-run adjustments.', inputSchema: s('Continuous discovery', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'discovery_list', description: 'List discovery jobs and candidate decision counts.', inputSchema: s('Discovery jobs', { projectId: { type: 'string' }, limit: { type: 'number' } }, ['projectId']) },
  { name: 'discovery_context', description: 'Read one discovery job with candidates, executor lease, atomic budgets, outcome summary, evidence counts and unresolved questions.', inputSchema: s('Discovery job', { projectId: { type: 'string' }, jobId: { type: 'string' } }, ['projectId','jobId']) },
  { name: 'discovery_claim', description: 'Atomically claim a human-created waiting discovery job. Creates the bounded shared work session and executor lease.', inputSchema: s('Claim discovery', { projectId: { type: 'string' }, jobId: { type: 'string' }, leaseSeconds: { type: 'number' } }, ['projectId','jobId']) },
  { name: 'discovery_heartbeat', description: 'Renew the current executor lease while actively working a claimed discovery job.', inputSchema: s('Discovery heartbeat', { projectId: { type: 'string' }, jobId: { type: 'string' }, leaseSeconds: { type: 'number' } }, ['projectId','jobId']) },
  { name: 'discovery_import_candidates', description: 'Import bounded candidate observations gathered by the claiming agent. Existing workspace keywords are deduplicated and candidate writes are capped atomically.', inputSchema: s('Import candidates', { projectId: { type: 'string' }, jobId: { type: 'string' }, candidates: { type: 'array', items: { type: 'object', properties: { keyword: { type: 'string' }, demandValue: { type: 'number' }, demandProvider: { type: 'string' }, observedAt: { type: 'string' }, adCompetition: { type: 'number' }, sourceId: { type: 'string' } }, required: ['keyword'] } } }, ['projectId','jobId','candidates']) },
  { name: 'discovery_ads_ideas', description: 'Reserve one discovery external-request unit for Google Ads ideas. Reusing a successful idempotencyKey returns cached evidence; advertising competition is not SEO difficulty.', inputSchema: s('Ads discovery', { projectId: { type: 'string' }, jobId: { type: 'string' }, seedKeywords: { type: 'array', items: { type: 'string' } }, url: { type: 'string' }, languageId: { type: 'string' }, geoTargetIds: { type: 'array', items: { type: 'string' } }, idempotencyKey: { type: 'string' } }, ['projectId','jobId']) },
  { name: 'discovery_serp', description: 'Reserve one discovery external-request unit to capture SERP evidence for a candidate, with idempotency protection.', inputSchema: s('SERP candidate research', { projectId: { type: 'string' }, jobId: { type: 'string' }, candidateId: { type: 'string' }, num: { type: 'number' }, idempotencyKey: { type: 'string' } }, ['projectId','jobId','candidateId']) },
  { name: 'discovery_web_evidence', description: 'Reserve one discovery external-request unit to link a public-web source to a candidate, with idempotency protection.', inputSchema: s('Web candidate evidence', { projectId: { type: 'string' }, jobId: { type: 'string' }, candidateId: { type: 'string' }, url: { type: 'string' }, idempotencyKey: { type: 'string' } }, ['projectId','jobId','candidateId','url']) },
  { name: 'discovery_annotate', description: 'Store a concise search-intent hypothesis and unresolved questions for one candidate.', inputSchema: s('Candidate annotation', { projectId: { type: 'string' }, jobId: { type: 'string' }, candidateId: { type: 'string' }, searchIntent: { type: 'string' }, unresolvedQuestions: { type: 'array', items: { type: 'string' } } }, ['projectId','jobId','candidateId']) },
  { name: 'discovery_finish_research', description: 'Finish the agent research phase and hand candidates to human review. This releases the executor lease and does not shortlist or approve anything.', inputSchema: s('Finish discovery research', { projectId: { type: 'string' }, jobId: { type: 'string' }, summary: { type: 'string' } }, ['projectId','jobId','summary']) }
];

const names = new Set(productTools.map(tool => tool.name));
export const isProductTool = (name: string) => names.has(name);

export async function callProductTool(name: string, a: any, ctx: CommandContext) {
  switch (name) {
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