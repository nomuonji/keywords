import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { commands } from '@keywords/commands';
import { planningCommands } from '@keywords/commands/planning';

const ctx = { actor: 'agent' as const, actorId: process.env.KEYWORDS_AGENT_ID ?? 'mcp' };
const server = new Server({ name: 'keywords', version: '0.4.0' }, { capabilities: { tools: {} } });
const s = (description: string, properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, description, properties, required });
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const tools = [
  { name: 'project_list', description: 'List SEO projects', inputSchema: s('No input', {}) },
  { name: 'project_snapshot', description: 'Read a compact project snapshot before deciding what to do', inputSchema: s('Project', { projectId: { type: 'string' } }, ['projectId']) },
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
  { name: 'page_propose', description: 'Legacy lightweight page proposal without explicit targets', inputSchema: s('Page proposal', { projectId: { type: 'string' }, title: { type: 'string' }, slug: { type: 'string' }, clusterId: { type: 'string' }, kind: { type: 'string' } }, ['projectId','title']) },
  { name: 'page_plan', description: 'Create an evidence-backed page proposal with primary/secondary keyword targets and cannibalization warnings', inputSchema: s('Page plan', { projectId: { type: 'string' }, title: { type: 'string' }, slug: { type: 'string' }, clusterId: { type: 'string' }, kind: { type: 'string' }, rationale: { type: 'string' }, primaryKeywordId: { type: 'string' }, secondaryKeywordIds: { type: 'array', items: { type: 'string' } }, sourceIds: { type: 'array', items: { type: 'string' } } }, ['projectId','title']) },
  { name: 'page_targets', description: 'Inspect one page proposal together with explicit keyword targets and linked evidence IDs', inputSchema: s('Page targets', { projectId: { type: 'string' }, pageId: { type: 'string' } }, ['projectId','pageId']) },
  { name: 'page_cannibalization', description: 'Detect multiple non-archived pages targeting the same keyword or sharing one content cluster', inputSchema: s('Cannibalization', { projectId: { type: 'string' }, limit: { type: 'number' } }, ['projectId']) },
  { name: 'insight_list', description: 'List agent/human insights', inputSchema: s('Project', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'insight_create', description: 'Store a research or strategy insight', inputSchema: s('Insight', { projectId: { type: 'string' }, type: { type: 'string' }, text: { type: 'string' }, confidence: { type: 'number' }, sourceId: { type: 'string' } }, ['projectId','type','text']) },
  { name: 'task_list', description: 'List shared human/agent tasks', inputSchema: s('Project', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'task_create', description: 'Create a shared task', inputSchema: s('Task', { projectId: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'number' }, assigneeType: { type: 'string' } }, ['projectId','title']) },
  { name: 'decision_record', description: 'Record an approve/reject/edit judgment so later agents can learn from it', inputSchema: s('Decision', { projectId: { type: 'string' }, action: { type: 'string' }, targetType: { type: 'string' }, targetId: { type: 'string' }, verdict: { type: 'string' }, reason: { type: 'string' } }, ['projectId','action','targetType','verdict']) }
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  const a = (request.params.arguments ?? {}) as any;
  switch (request.params.name) {
    case 'project_list': return text(await commands.project.list(ctx));
    case 'project_snapshot': return text(await commands.project.snapshot(ctx, a.projectId));
    case 'research_context': return text(await commands.research.context(ctx, a.projectId));
    case 'opportunity_context': return text(await commands.research.opportunities(ctx, a.projectId, a.limit));
    case 'source_list': return text(await commands.source.list(ctx, a.projectId, a.type));
    case 'source_record': return text(await commands.source.record(ctx, a));
    case 'research_web_fetch': return text(await commands.research.webFetch(ctx, a));
    case 'research_serp': return text(await commands.research.serp(ctx, a));
    case 'research_google_ads_keywords': return text(await commands.research.googleAdsKeywordIdeas(ctx, a));
    case 'research_search_console': return text(await commands.research.searchConsole(ctx, a));
    case 'keyword_list': return text(await commands.keyword.list(ctx, a.projectId, a.status));
    case 'keyword_create': return text(await commands.keyword.create(ctx, a));
    case 'keyword_reject': return text(await commands.keyword.reject(ctx, a));
    case 'cluster_list': return text(await commands.cluster.list(ctx, a.projectId));
    case 'cluster_create': return text(await commands.cluster.create(ctx, a));
    case 'cluster_add_keyword': return text(await commands.cluster.addKeyword(ctx, a));
    case 'cluster_bulk_assign': return text(await planningCommands.clusterBulkAssign(ctx, a));
    case 'page_list': return text(await commands.page.list(ctx, a.projectId));
    case 'page_propose': return text(await commands.page.propose(ctx, a));
    case 'page_plan': return text(await planningCommands.pagePlan(ctx, a));
    case 'page_targets': return text(await planningCommands.pageTargets(ctx, a));
    case 'page_cannibalization': return text(await planningCommands.pageCannibalization(ctx, a));
    case 'insight_list': return text(await commands.insight.list(ctx, a.projectId));
    case 'insight_create': return text(await commands.insight.create(ctx, a));
    case 'task_list': return text(await commands.task.list(ctx, a.projectId));
    case 'task_create': return text(await commands.task.create(ctx, a));
    case 'decision_record': return text(await commands.decision.record(ctx, a));
    default: throw new Error(`Unknown tool: ${request.params.name}`);
  }
});
await server.connect(new StdioServerTransport());
