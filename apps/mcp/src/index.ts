import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { commands } from '@keywords/commands';
import { planningCommands } from '@keywords/commands/planning';
import { policyCommands } from '@keywords/commands/policy';
import { workCommands } from '@keywords/commands/work';

const baseCtx = { actor: 'agent' as const, actorId: process.env.KEYWORDS_AGENT_ID ?? 'mcp' };
let activeWorkSession: { id: string; projectId: string; status: string; remainingActions: number } | null = null;
const server = new Server({ name: 'keywords', version: '0.6.0' }, { capabilities: { tools: {} } });
const s = (description: string, properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, description, properties, required });
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const toolCtx = (projectId?: string) => ({
  ...baseCtx,
  ...(activeWorkSession && (!projectId || activeWorkSession.projectId === projectId) ? { workSessionId: activeWorkSession.id } : {})
});
const sessionIdFor = (projectId: string, explicit?: string) => explicit ?? (activeWorkSession?.projectId === projectId ? activeWorkSession.id : undefined);
const budgetedTools = new Set([
  'source_record','research_web_fetch','research_serp','research_google_ads_keywords','research_search_console',
  'keyword_create','keyword_reject','cluster_create','cluster_add_keyword','cluster_bulk_assign','page_plan',
  'insight_create','task_create','task_set_status','policy_propose','decision_record'
]);
const allowedWhilePaused = new Set([
  'work_context','work_resume','work_checkpoint','work_complete','work_cancel','work_list',
  'project_snapshot','policy_context','research_context','opportunity_context','source_list','keyword_list','cluster_list',
  'page_list','page_targets','page_cannibalization','insight_list','task_list'
]);
function guardTool(name: string) {
  if (!activeWorkSession) return;
  if ((activeWorkSession.status === 'awaiting_review' || activeWorkSession.status === 'blocked') && !allowedWhilePaused.has(name)) {
    throw new Error(`Work session ${activeWorkSession.id} is ${activeWorkSession.status}. Use work_context/work_resume or finish the session before more writes or external research.`);
  }
  if (budgetedTools.has(name) && activeWorkSession.remainingActions <= 0) {
    throw new Error(`Work session ${activeWorkSession.id} has exhausted its action budget. Use work_checkpoint or work_complete.`);
  }
}
function consumeBudget(name: string) {
  if (activeWorkSession && budgetedTools.has(name)) activeWorkSession.remainingActions = Math.max(0, activeWorkSession.remainingActions - 1);
}
function syncSession(value: any, projectId: string) {
  if (!value?.id) return;
  activeWorkSession = { id: value.id, projectId, status: value.status ?? 'running', remainingActions: Number(value.remainingActions ?? 0) };
}

const tools = [
  { name: 'project_list', description: 'List SEO projects', inputSchema: s('No input', {}) },
  { name: 'project_snapshot', description: 'Read a compact project snapshot before deciding what to do', inputSchema: s('Project', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'work_context', description: 'Read the compact agent work context: active policies, prioritized tasks, review queue, top opportunities, current session and next recommended focus', inputSchema: s('Work context', { projectId: { type: 'string' }, sessionId: { type: 'string' } }, ['projectId']) },
  { name: 'work_start', description: 'Start one auditable agent work session with an objective, completion criteria and bounded action budget. Only one unfinished session is allowed per project.', inputSchema: s('Start work', { projectId: { type: 'string' }, objective: { type: 'string' }, completionCriteria: { type: 'array', items: { type: 'string' } }, maxActions: { type: 'number' } }, ['projectId']) },
  { name: 'work_resume', description: 'Resume a blocked or awaiting-review work session after the external condition has changed', inputSchema: s('Resume work', { projectId: { type: 'string' }, sessionId: { type: 'string' } }, ['projectId','sessionId']) },
  { name: 'work_checkpoint', description: 'Persist a concise progress/result summary and next action. Do not store private chain-of-thought.', inputSchema: s('Checkpoint', { projectId: { type: 'string' }, sessionId: { type: 'string' }, state: { type: 'string', enum: ['working','awaiting_review','blocked'] }, summary: { type: 'string' }, nextAction: { type: 'string' } }, ['projectId','state','summary']) },
  { name: 'work_complete', description: 'Finish the current work session with a concise outcome summary and baseline-to-current project diff', inputSchema: s('Complete work', { projectId: { type: 'string' }, sessionId: { type: 'string' }, summary: { type: 'string' } }, ['projectId','summary']) },
  { name: 'work_cancel', description: 'Cancel an unfinished work session with a reason', inputSchema: s('Cancel work', { projectId: { type: 'string' }, sessionId: { type: 'string' }, reason: { type: 'string' } }, ['projectId','reason']) },
  { name: 'work_list', description: 'List recent agent work sessions and their action usage', inputSchema: s('Work sessions', { projectId: { type: 'string' }, limit: { type: 'number' } }, ['projectId']) },
  { name: 'policy_context', description: 'Read active project-specific operating rules, policy candidates, and recent human decisions before planning work', inputSchema: s('Policy context', { projectId: { type: 'string' }, recentDecisionLimit: { type: 'number' } }, ['projectId']) },
  { name: 'policy_propose', description: 'Propose a durable project rule backed by one or more decision IDs. Human review is required before it becomes active.', inputSchema: s('Policy candidate', { projectId: { type: 'string' }, scope: { type: 'string' }, rule: { type: 'string' }, rationale: { type: 'string' }, sourceDecisionIds: { type: 'array', items: { type: 'string' } } }, ['projectId','rule','sourceDecisionIds']) },
  { name: 'research_context', description: 'Read keywords, unclustered backlog, insights, and recent research sources in one compact context', inputSchema: s('Project', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'opportunity_context', description: 'Read compact ranked SEO opportunities derived from normalized Google Ads and Search Console metrics', inputSchema: s('Opportunity context', { projectId: { type: 'string' }, limit: { type: 'number' } }, ['projectId']) },
  { name: 'source_list', description: 'List stored research sources, optionally filtered by source type', inputSchema: s('Sources', { projectId: { type: 'string' }, type: { type: 'string' } }, ['projectId']) },
  { name: 'source_record', description: 'Persist evidence gathered by the agent or another research tool', inputSchema: s('Source', { projectId: { type: 'string' }, type: { type: 'string' }, label: { type: 'string' }, url: { type: 'string' }, metadata: { type: 'object', additionalProperties: true } }, ['projectId','type','label']) },
  { name: 'research_web_fetch', description: 'Fetch a public web page and store a normalized text source. Private/local network targets are blocked by default.', inputSchema: s('Web fetch', { projectId: { type: 'string' }, url: { type: 'string' }, maxChars: { type: 'number' } }, ['projectId','url']) },
  { name: 'research_serp', description: 'Query a Google SERP through a configured Serper-compatible endpoint and persist the results', inputSchema: s('SERP research', { projectId: { type: 'string' }, query: { type: 'string' }, country: { type: 'string' }, language: { type: 'string' }, location: { type: 'string' }, num: { type: 'number' } }, ['projectId','query']) },
  { name: 'research_google_ads_keywords', description: 'Generate Google Ads keyword ideas with historical metrics, store the source, and import/upsert ideas into the keyword workspace', inputSchema: s('Google Ads keyword research', { projectId: { type: 'string' }, customerId: { type: 'string' }, seedKeywords: { type: 'array', items: { type: 'string' } }, url: { type: 'string' }, languageId: { type: 'string' }, geoTargetIds: { type: 'array', items: { type: 'string' } }, network: { type: 'string', enum: ['GOOGLE_SEARCH','GOOGLE_SEARCH_AND_PARTNERS'] }, importKeywords: { type: 'boolean' } }, ['projectId']) },
  { name: 'research_search_console', description: 'Query Search Console Search Analytics, persist the result, and normalize query performance onto keywords for opportunity analysis', inputSchema: s('Search Console research', { projectId: { type: 'string' }, siteUrl: { type: 'string' }, startDate: { type: 'string' }, endDate: { type: 'string' }, dimensions: { type: 'array', items: { type: 'string' } }, rowLimit: { type: 'number' }, startRow: { type: 'number' }, searchType: { type: 'string' }, importQueries: { type: 'boolean' } }, ['projectId','startDate','endDate']) },
  { name: 'keyword_list', description: 'List project keywords and their cluster assignment', inputSchema: s('Project', { projectId: { type: 'string' }, status: { type: 'string' } }, ['projectId']) },
  { name: 'keyword_create', description: 'Add a keyword to the workspace', inputSchema: s('Keyword', { projectId: { type: 'string' }, text: { type: 'string' }, source: { type: 'string' }, avgMonthly: { type: 'number' }, competition: { type: 'number' } }, ['projectId','text']) },
  { name: 'keyword_reject', description: 'Reject a keyword and optionally record the reason as a decision', inputSchema: s('Reject keyword', { projectId: { type: 'string' }, keywordId: { type: 'string' }, reason: { type: 'string' } }, ['projectId','keywordId']) },
  { name: 'cluster_list', description: 'List content clusters', inputSchema: s('Project', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'cluster_create', description: 'Create a cluster, optionally with keyword IDs', inputSchema: s('Cluster', { projectId: { type: 'string' }, title: { type: 'string' }, intent: { type: 'string' }, keywordIds: { type: 'array', items: { type: 'string' } } }, ['projectId','title']) },
  { name: 'cluster_add_keyword', description: 'Move a keyword into a cluster', inputSchema: s('Assignment', { projectId: { type: 'string' }, clusterId: { type: 'string' }, keywordId: { type: 'string' } }, ['projectId','clusterId','keywordId']) },
  { name: 'cluster_bulk_assign', description: 'Move many project keywords into one cluster in a single audited command', inputSchema: s('Bulk cluster assignment', { projectId: { type: 'string' }, clusterId: { type: 'string' }, keywordIds: { type: 'array', items: { type: 'string' } } }, ['projectId','clusterId','keywordIds']) },
  { name: 'page_list', description: 'List proposed/approved/archived pages', inputSchema: s('Project', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'page_plan', description: 'Create an evidence-backed page proposal with primary/secondary keyword targets and cannibalization warnings', inputSchema: s('Page plan', { projectId: { type: 'string' }, title: { type: 'string' }, slug: { type: 'string' }, clusterId: { type: 'string' }, kind: { type: 'string' }, rationale: { type: 'string' }, primaryKeywordId: { type: 'string' }, secondaryKeywordIds: { type: 'array', items: { type: 'string' } }, sourceIds: { type: 'array', items: { type: 'string' } } }, ['projectId','title']) },
  { name: 'page_targets', description: 'Inspect one page proposal together with explicit keyword targets and linked evidence IDs', inputSchema: s('Page targets', { projectId: { type: 'string' }, pageId: { type: 'string' } }, ['projectId','pageId']) },
  { name: 'page_cannibalization', description: 'Detect multiple non-archived pages targeting the same keyword or sharing one content cluster', inputSchema: s('Cannibalization', { projectId: { type: 'string' }, limit: { type: 'number' } }, ['projectId']) },
  { name: 'insight_list', description: 'List agent/human insights', inputSchema: s('Project', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'insight_create', description: 'Store a research or strategy insight', inputSchema: s('Insight', { projectId: { type: 'string' }, type: { type: 'string' }, text: { type: 'string' }, confidence: { type: 'number' }, sourceId: { type: 'string' } }, ['projectId','type','text']) },
  { name: 'task_list', description: 'List shared human/agent tasks', inputSchema: s('Project', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'task_create', description: 'Create a shared task', inputSchema: s('Task', { projectId: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'number' }, assigneeType: { type: 'string' } }, ['projectId','title']) },
  { name: 'task_set_status', description: 'Move a shared task between todo, doing, review, and done', inputSchema: s('Task status', { projectId: { type: 'string' }, taskId: { type: 'string' }, status: { type: 'string', enum: ['todo','doing','review','done'] } }, ['projectId','taskId','status']) },
  { name: 'decision_record', description: 'Record an approve/reject/edit judgment so later agents can learn from it', inputSchema: s('Decision', { projectId: { type: 'string' }, action: { type: 'string' }, targetType: { type: 'string' }, targetId: { type: 'string' }, verdict: { type: 'string' }, reason: { type: 'string' } }, ['projectId','action','targetType','verdict']) }
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  const a = (request.params.arguments ?? {}) as any;
  const name = request.params.name;
  guardTool(name);
  let result: unknown;
  switch (name) {
    case 'project_list': result = await commands.project.list(baseCtx); break;
    case 'project_snapshot': result = await commands.project.snapshot(toolCtx(a.projectId), a.projectId); break;
    case 'work_context': {
      result = await workCommands.context(toolCtx(a.projectId), { projectId: a.projectId, sessionId: sessionIdFor(a.projectId, a.sessionId) });
      const session = (result as any)?.session;
      if (session?.id) syncSession(session, a.projectId);
      break;
    }
    case 'work_start': {
      result = await workCommands.start(baseCtx, a);
      syncSession(result, a.projectId);
      break;
    }
    case 'work_resume': {
      result = await workCommands.resume(baseCtx, a);
      syncSession(result, a.projectId);
      break;
    }
    case 'work_checkpoint': {
      const sessionId = sessionIdFor(a.projectId, a.sessionId);
      if (!sessionId) throw new Error('No active work session. Supply sessionId or call work_start/work_resume.');
      result = await workCommands.checkpoint(toolCtx(a.projectId), { ...a, sessionId });
      syncSession(result, a.projectId);
      break;
    }
    case 'work_complete': {
      const sessionId = sessionIdFor(a.projectId, a.sessionId);
      if (!sessionId) throw new Error('No active work session. Supply sessionId or call work_start/work_resume.');
      result = await workCommands.complete(toolCtx(a.projectId), { ...a, sessionId });
      activeWorkSession = null;
      break;
    }
    case 'work_cancel': {
      const sessionId = sessionIdFor(a.projectId, a.sessionId);
      if (!sessionId) throw new Error('No active work session. Supply sessionId or call work_start/work_resume.');
      result = await workCommands.cancel(toolCtx(a.projectId), { ...a, sessionId });
      activeWorkSession = null;
      break;
    }
    case 'work_list': result = await workCommands.list(toolCtx(a.projectId), a.projectId, a.limit); break;
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
    default: throw new Error(`Unknown tool: ${name}`);
  }
  consumeBudget(name);
  return text(result);
});
await server.connect(new StdioServerTransport());
