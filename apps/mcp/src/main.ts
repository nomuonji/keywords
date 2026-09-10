import { portfolioCommands } from '@keywords/commands/portfolio';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { commands } from '@keywords/commands';
import { planningCommands } from '@keywords/commands/planning';
import { policyCommands } from '@keywords/commands/policy';
import { workCommands } from '@keywords/commands/work';
import { reviewCommands } from '@keywords/commands/review';
import { siteCommands } from '@keywords/commands/site';
import { metricsCommands } from '@keywords/commands/metrics';
import { operatorCommands } from '@keywords/commands/operator';
import { operationControl } from '@keywords/commands/guard';
import { productTools, isProductTool, callProductTool } from './product.js';
import { blogTools, isBlogTool, callBlogTool } from './blog.js';

const baseCtx = { actor: 'agent' as const, actorId: process.env.KEYWORDS_AGENT_ID ?? 'mcp' };
let activeWorkSession: { id: string; projectId: string; status: string; remainingActions: number } | null = null;
const server = new Server({ name: 'keywords', version: '1.0.0' }, { capabilities: { tools: {} } });
const s = (description: string, properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, description, properties, required });
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const toolCtx = (projectId?: string) => ({ ...baseCtx, ...(activeWorkSession && (!projectId || activeWorkSession.projectId === projectId) ? { workSessionId: activeWorkSession.id } : {}) });
const sessionIdFor = (projectId: string, explicit?: string) => explicit ?? (activeWorkSession?.projectId === projectId ? activeWorkSession.id : undefined);

const budgetedTools = new Set([
  'recovery_capture',
  'blog_importContext','blog_prepare','blog_export','blog_receipt','blog_capture','blog_expand',
  'blog_observe',
  'source_record','research_web_fetch','research_serp','research_google_ads_keywords','research_search_console','site_sync','metrics_capture',
  'keyword_create','keyword_reject','cluster_create','cluster_add_keyword','cluster_bulk_assign','page_plan','insight_create','task_create','task_set_status','policy_propose','decision_record',
  'discovery_import_candidates','discovery_ads_ideas','discovery_serp','discovery_web_evidence','discovery_annotate'
]);
const allowedWhilePaused = new Set([
  'recovery_context',
  'blog_context','blog_get','blog_evaluate','blog_observations',
  'blog_contract',
  'work_context','work_checkpoint','work_complete','work_cancel','work_list','review_list','portfolio_context','project_snapshot','operator_context','site_list','metrics_context','policy_context','research_context','opportunity_context','source_list','keyword_list','cluster_list','page_list','page_targets','page_cannibalization','insight_list','task_list',
  'project_brief','project_capabilities','workspace_keyword_search','evidence_for_target','continuous_discovery_context','discovery_list','discovery_context',
  'operation_context','operation_checkpoint','operation_complete','operation_outcomes','measurement_context','remote_readiness'
]);
function guardTool(name: string, args: any) {
  if (name === 'work_start') throw new Error('Direct agent work_start is disabled. Use operation_start, or claim a human-created legacy discovery job.');
  const projectId = typeof args?.projectId === 'string' ? args.projectId : activeWorkSession?.projectId;
  if (projectId && operationControl(projectId).paused && !allowedWhilePaused.has(name)) {
    throw new Error(`Agent operations are paused for project ${projectId}. Read operation_context or wait for a human to resume it.`);
  }
  if (budgetedTools.has(name) && !activeWorkSession) {
    throw new Error('Budgeted MCP research/write requires an active shared Operation or a claimed legacy discovery job. Use operation_start/operation_resume or discovery_claim first.');
  }
  if (!activeWorkSession) return;
  if (['awaiting_review','blocked'].includes(activeWorkSession.status) && !allowedWhilePaused.has(name)) throw new Error(`Work session ${activeWorkSession.id} is ${activeWorkSession.status}. Read context or resume/finish before more writes or research.`);
  if (budgetedTools.has(name) && activeWorkSession.remainingActions <= 0) throw new Error(`Work session ${activeWorkSession.id} has exhausted its action budget. Checkpoint or complete it.`);
}
function consumeBudget(name: string) { if (activeWorkSession && budgetedTools.has(name)) activeWorkSession.remainingActions = Math.max(0, activeWorkSession.remainingActions - 1); }
function syncSession(value: any, projectId: string) { if (value?.id) activeWorkSession = { id: value.id, projectId, status: value.status ?? 'running', remainingActions: Number(value.remainingActions ?? 0) }; }

const coreTools = [
  { name: 'project_list', description: 'List SEO projects.', inputSchema: s('No input', {}) },
  { name: 'project_snapshot', description: 'Read compact project counts and recent command activity.', inputSchema: s('Project', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'operator_context', description: 'Read the deterministic reasoned next-action queue. This does not execute SEO work.', inputSchema: s('Operator', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'site_list', description: 'List real URLs observed from sitemap/Search Console.', inputSchema: s('Site', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'site_sync', description: 'Synchronize a bounded sitemap inventory.', inputSchema: s('Site sync', { projectId: { type: 'string' }, sitemapUrl: { type: 'string' } }, ['projectId']) },
  { name: 'metrics_context', description: 'Compare compatible Search Console periods only.', inputSchema: s('Metrics', { projectId: { type: 'string' }, limit: { type: 'number' } }, ['projectId']) },
  { name: 'metrics_capture', description: 'Capture query/page Search Console history.', inputSchema: s('Capture metrics', { projectId: { type: 'string' }, siteUrl: { type: 'string' }, startDate: { type: 'string' }, endDate: { type: 'string' }, searchType: { type: 'string' }, rowLimit: { type: 'number' } }, ['projectId','startDate','endDate']) },
  { name: 'work_context', description: 'Read the current work session, policies, tasks, reviews and next focus.', inputSchema: s('Work context', { projectId: { type: 'string' }, sessionId: { type: 'string' } }, ['projectId']) },
  { name: 'work_start', description: 'Legacy direct start is disabled for MCP agents; use operation_start.', inputSchema: s('Start work', { projectId: { type: 'string' }, objective: { type: 'string' }, completionCriteria: { type: 'array', items: { type: 'string' } }, maxActions: { type: 'number' } }, ['projectId']) },
  { name: 'work_resume', description: 'Resume an eligible unfinished session.', inputSchema: s('Resume', { projectId: { type: 'string' }, sessionId: { type: 'string' } }, ['projectId','sessionId']) },
  { name: 'work_checkpoint', description: 'Persist outcome/blocker/next action, not private reasoning.', inputSchema: s('Checkpoint', { projectId: { type: 'string' }, sessionId: { type: 'string' }, state: { type: 'string', enum: ['working','awaiting_review','blocked'] }, summary: { type: 'string' }, nextAction: { type: 'string' } }, ['projectId','state','summary']) },
  { name: 'work_complete', description: 'Complete work with a concise summary.', inputSchema: s('Complete', { projectId: { type: 'string' }, sessionId: { type: 'string' }, summary: { type: 'string' } }, ['projectId','summary']) },
  { name: 'work_cancel', description: 'Cancel unfinished work with a reason.', inputSchema: s('Cancel', { projectId: { type: 'string' }, sessionId: { type: 'string' }, reason: { type: 'string' } }, ['projectId','reason']) },
  { name: 'work_list', description: 'List work sessions and budgets.', inputSchema: s('Work list', { projectId: { type: 'string' }, limit: { type: 'number' } }, ['projectId']) },
  { name: 'review_request', description: 'Request an explicit human decision and pause the session.', inputSchema: s('Review request', { projectId: { type: 'string' }, sessionId: { type: 'string' }, targetType: { type: 'string' }, targetId: { type: 'string' }, title: { type: 'string' }, question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, ['projectId','targetType','title']) },
  { name: 'review_list', description: 'List review requests. Agents cannot resolve them.', inputSchema: s('Reviews', { projectId: { type: 'string' }, sessionId: { type: 'string' }, status: { type: 'string' }, limit: { type: 'number' } }, ['projectId']) },
  { name: 'policy_context', description: 'Read active/candidate project policies and recent human decisions.', inputSchema: s('Policy context', { projectId: { type: 'string' }, recentDecisionLimit: { type: 'number' } }, ['projectId']) },
  { name: 'policy_propose', description: 'Propose a decision-backed policy candidate; humans activate it.', inputSchema: s('Policy proposal', { projectId: { type: 'string' }, scope: { type: 'string' }, rule: { type: 'string' }, rationale: { type: 'string' }, sourceDecisionIds: { type: 'array', items: { type: 'string' } } }, ['projectId','rule','sourceDecisionIds']) },
  { name: 'research_context', description: 'Read normalized research context.', inputSchema: s('Research', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'opportunity_context', description: 'Read normalized opportunity lenses. Ads competition is advertising competition, never SEO difficulty.', inputSchema: s('Opportunities', { projectId: { type: 'string' }, limit: { type: 'number' } }, ['projectId']) },
  { name: 'source_list', description: 'List stored sources.', inputSchema: s('Sources', { projectId: { type: 'string' }, type: { type: 'string' } }, ['projectId']) },
  { name: 'source_record', description: 'Store a source without credentials.', inputSchema: s('Source', { projectId: { type: 'string' }, type: { type: 'string' }, label: { type: 'string' }, url: { type: 'string' }, metadata: { type: 'object', additionalProperties: true } }, ['projectId','type','label']) },
  { name: 'research_web_fetch', description: 'Fetch bounded public-web evidence.', inputSchema: s('Web', { projectId: { type: 'string' }, url: { type: 'string' }, maxChars: { type: 'number' } }, ['projectId','url']) },
  { name: 'research_serp', description: 'Fetch SERP evidence.', inputSchema: s('SERP', { projectId: { type: 'string' }, query: { type: 'string' }, country: { type: 'string' }, language: { type: 'string' }, location: { type: 'string' }, num: { type: 'number' } }, ['projectId','query']) },
  { name: 'research_google_ads_keywords', description: 'Fetch Google Ads keyword demand; competition is advertising competition.', inputSchema: s('Ads', { projectId: { type: 'string' }, customerId: { type: 'string' }, seedKeywords: { type: 'array', items: { type: 'string' } }, url: { type: 'string' }, languageId: { type: 'string' }, geoTargetIds: { type: 'array', items: { type: 'string' } }, importKeywords: { type: 'boolean' } }, ['projectId']) },
  { name: 'research_search_console', description: 'Run an ad-hoc Search Console query.', inputSchema: s('GSC', { projectId: { type: 'string' }, siteUrl: { type: 'string' }, startDate: { type: 'string' }, endDate: { type: 'string' }, dimensions: { type: 'array', items: { type: 'string' } }, rowLimit: { type: 'number' }, startRow: { type: 'number' }, searchType: { type: 'string' }, importQueries: { type: 'boolean' } }, ['projectId','startDate','endDate']) },
  { name: 'keyword_list', description: 'List keyword rows.', inputSchema: s('Keywords', { projectId: { type: 'string' }, status: { type: 'string' } }, ['projectId']) },
  { name: 'keyword_create', description: 'Create a keyword.', inputSchema: s('Keyword', { projectId: { type: 'string' }, text: { type: 'string' }, source: { type: 'string' }, avgMonthly: { type: 'number' }, competition: { type: 'number' } }, ['projectId','text']) },
  { name: 'keyword_reject', description: 'Reject a keyword.', inputSchema: s('Reject', { projectId: { type: 'string' }, keywordId: { type: 'string' }, reason: { type: 'string' } }, ['projectId','keywordId']) },
  { name: 'cluster_list', description: 'List clusters.', inputSchema: s('Clusters', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'cluster_create', description: 'Create a cluster.', inputSchema: s('Cluster', { projectId: { type: 'string' }, title: { type: 'string' }, intent: { type: 'string' }, keywordIds: { type: 'array', items: { type: 'string' } } }, ['projectId','title']) },
  { name: 'cluster_add_keyword', description: 'Move a keyword to a cluster.', inputSchema: s('Assign', { projectId: { type: 'string' }, clusterId: { type: 'string' }, keywordId: { type: 'string' } }, ['projectId','clusterId','keywordId']) },
  { name: 'cluster_bulk_assign', description: 'Assign multiple keywords.', inputSchema: s('Bulk assign', { projectId: { type: 'string' }, clusterId: { type: 'string' }, keywordIds: { type: 'array', items: { type: 'string' } } }, ['projectId','clusterId','keywordIds']) },
  { name: 'page_list', description: 'List workspace and live pages.', inputSchema: s('Pages', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'page_plan', description: 'Create an evidence-backed new-page or existing-page-improvement proposal.', inputSchema: s('Page plan', { projectId: { type: 'string' }, title: { type: 'string' }, slug: { type: 'string' }, clusterId: { type: 'string' }, kind: { type: 'string' }, rationale: { type: 'string' }, audience: { type: 'string' }, question: { type: 'string' }, searchIntent: { type: 'string' }, uniqueAngle: { type: 'string' }, unresolvedAssumptions: { type: 'array', items: { type: 'string' } }, planMode: { type: 'string', enum: ['new_page','existing_page_improvement'] }, targetPageId: { type: 'string' }, primaryKeywordId: { type: 'string' }, secondaryKeywordIds: { type: 'array', items: { type: 'string' } }, sourceIds: { type: 'array', items: { type: 'string' } } }, ['projectId','title']) },
  { name: 'page_targets', description: 'Inspect targets/evidence for one page plan.', inputSchema: s('Page targets', { projectId: { type: 'string' }, pageId: { type: 'string' } }, ['projectId','pageId']) },
  { name: 'page_cannibalization', description: 'Inspect overlap signals.', inputSchema: s('Cannibalization', { projectId: { type: 'string' }, limit: { type: 'number' } }, ['projectId']) },
  { name: 'insight_list', description: 'List insights.', inputSchema: s('Insights', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'insight_create', description: 'Create an evidence-linked insight.', inputSchema: s('Insight', { projectId: { type: 'string' }, type: { type: 'string' }, text: { type: 'string' }, confidence: { type: 'number' }, sourceId: { type: 'string' } }, ['projectId','type','text']) },
  { name: 'task_list', description: 'List shared tasks.', inputSchema: s('Tasks', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'task_create', description: 'Create a shared task.', inputSchema: s('Task', { projectId: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'number' }, assigneeType: { type: 'string' } }, ['projectId','title']) },
  { name: 'task_set_status', description: 'Set task status.', inputSchema: s('Task status', { projectId: { type: 'string' }, taskId: { type: 'string' }, status: { type: 'string', enum: ['todo','doing','review','done'] } }, ['projectId','taskId','status']) },
  { name: 'decision_record', description: 'Record a decision for project memory.', inputSchema: s('Decision', { projectId: { type: 'string' }, action: { type: 'string' }, targetType: { type: 'string' }, targetId: { type: 'string' }, verdict: { type: 'string' }, reason: { type: 'string' } }, ['projectId','action','targetType','verdict']) }
];
const tools = [{ name: 'portfolio_context', description: 'Read Blog portfolio GA4/GSC snapshot, freshness and shared work counts.', inputSchema: s('Portfolio', {}) }, ...blogTools, ...productTools, ...coreTools];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  const a = (request.params.arguments ?? {}) as any; const name = request.params.name; guardTool(name, a); let result: unknown;
  if (isBlogTool(name)) {
    result = await callBlogTool(name,a,toolCtx(a.projectId)); consumeBudget(name); return text(result);
  }
  switch (name) {
    case 'portfolio_context': result = await portfolioCommands.context(); break;
    case 'project_list': result = await commands.project.list(baseCtx); break;
    case 'project_snapshot': result = await commands.project.snapshot(toolCtx(a.projectId), a.projectId); break;
    case 'operator_context': result = await operatorCommands.inspect(toolCtx(a.projectId), a.projectId); break;
    case 'site_list': result = await siteCommands.list(toolCtx(a.projectId), a.projectId); break;
    case 'site_sync': result = await siteCommands.syncSitemap(toolCtx(a.projectId), a); break;
    case 'metrics_context': result = await metricsCommands.context(toolCtx(a.projectId), a.projectId, a.limit); break;
    case 'metrics_capture': result = await metricsCommands.capture(toolCtx(a.projectId), a); break;
    case 'work_context': { const sessionId = sessionIdFor(a.projectId, a.sessionId); const context = await workCommands.context(toolCtx(a.projectId), { projectId: a.projectId, sessionId }); const session = (context as any)?.session; if (session?.id) syncSession(session, a.projectId); const reviewRequests = await reviewCommands.list(toolCtx(a.projectId), { projectId: a.projectId, sessionId: session?.id, status: 'open', limit: 20 }); result = { ...(context as Record<string, unknown>), reviewRequests }; break; }
    case 'work_start': throw new Error('Direct agent work_start is disabled. Use operation_start.');
    case 'work_resume': result = await workCommands.resume(baseCtx, a); syncSession(result, a.projectId); break;
    case 'work_checkpoint': { const sessionId = sessionIdFor(a.projectId, a.sessionId); if (!sessionId) throw new Error('No active work session.'); result = await workCommands.checkpoint(toolCtx(a.projectId), { ...a, sessionId }); syncSession(result, a.projectId); break; }
    case 'work_complete': { const sessionId = sessionIdFor(a.projectId, a.sessionId); if (!sessionId) throw new Error('No active work session.'); result = await workCommands.complete(toolCtx(a.projectId), { ...a, sessionId }); activeWorkSession = null; break; }
    case 'work_cancel': { const sessionId = sessionIdFor(a.projectId, a.sessionId); if (!sessionId) throw new Error('No active work session.'); result = await workCommands.cancel(toolCtx(a.projectId), { ...a, sessionId }); activeWorkSession = null; break; }
    case 'work_list': result = await workCommands.list(toolCtx(a.projectId), a.projectId, a.limit); break;
    case 'review_request': { const sessionId = sessionIdFor(a.projectId, a.sessionId); if (!sessionId) throw new Error('No active work session.'); result = await reviewCommands.request(toolCtx(a.projectId), { ...a, sessionId }); if (activeWorkSession?.id === sessionId) activeWorkSession.status = 'awaiting_review'; break; }
    case 'review_list': result = await reviewCommands.list(toolCtx(a.projectId), { projectId: a.projectId, sessionId: sessionIdFor(a.projectId, a.sessionId), status: a.status ?? 'open', limit: a.limit }); break;
    case 'policy_context': result = await policyCommands.context(toolCtx(a.projectId), a.projectId, a.recentDecisionLimit); break;
    case 'policy_propose': result = await policyCommands.propose(toolCtx(a.projectId), a); break;
    case 'research_context': result = await commands.research.context(toolCtx(a.projectId), a.projectId); break;
    case 'opportunity_context': result = await commands.research.opportunities(toolCtx(a.projectId), a.projectId, a.limit); break;
    case 'source_list': result = await commands.source.list(toolCtx(a.projectId), a.projectId, a.type); break;
    case 'source_record': result = await commands.source.record(toolCtx(a.projectId), a); break;
    case 'research_web_fetch': result = await commands.research.webFetch(toolCtx(a.projectId), a); break;
    case 'research_serp': result = await commands.research.serp(toolCtx(a.projectId), a); break;
    case 'research_google_ads_keywords': result = await commands.research.googleAdsKeywordIdeas(toolCtx(a.projectId), a); break;
    case 'research_search_console': result = await commands.research.searchConsole(toolCtx(a.projectId), a); break;
    case 'keyword_list': result = await commands.keyword.list(toolCtx(a.projectId), a.projectId, a.status); break;
    case 'keyword_create': result = await commands.keyword.create(toolCtx(a.projectId), a); break;
    case 'keyword_reject': result = await commands.keyword.reject(toolCtx(a.projectId), a); break;
    case 'cluster_list': result = await commands.cluster.list(toolCtx(a.projectId), a.projectId); break;
    case 'cluster_create': result = await commands.cluster.create(toolCtx(a.projectId), a); break;
    case 'cluster_add_keyword': result = await commands.cluster.addKeyword(toolCtx(a.projectId), a); break;
    case 'cluster_bulk_assign': result = await planningCommands.clusterBulkAssign(toolCtx(a.projectId), a); break;
    case 'page_list': result = await commands.page.list(toolCtx(a.projectId), a.projectId); break;
    case 'page_plan': result = await planningCommands.pagePlan(toolCtx(a.projectId), a); break;
    case 'page_targets': result = await planningCommands.pageTargets(toolCtx(a.projectId), a); break;
    case 'page_cannibalization': result = await planningCommands.pageCannibalization(toolCtx(a.projectId), a); break;
    case 'insight_list': result = await commands.insight.list(toolCtx(a.projectId), a.projectId); break;
    case 'insight_create': result = await commands.insight.create(toolCtx(a.projectId), a); break;
    case 'task_list': result = await commands.task.list(toolCtx(a.projectId), a.projectId); break;
    case 'task_create': result = await commands.task.create(toolCtx(a.projectId), a); break;
    case 'task_set_status': result = await commands.task.setStatus(toolCtx(a.projectId), a); break;
    case 'decision_record': result = await commands.decision.record(toolCtx(a.projectId), a); break;
    default:
      if (!isProductTool(name)) throw new Error(`Unknown tool: ${name}`);
      result = await callProductTool(name, a, toolCtx(a.projectId));
      if ((result as any)?.session?.id) syncSession((result as any).session, a.projectId);
  }
  consumeBudget(name); return text(result);
});
await server.connect(new StdioServerTransport());
