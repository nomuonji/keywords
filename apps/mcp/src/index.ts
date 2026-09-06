import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { commands } from '@keywords/commands';

const ctx = { actor: 'agent' as const, actorId: process.env.KEYWORDS_AGENT_ID ?? 'mcp' };
const server = new Server({ name: 'keywords', version: '0.1.0' }, { capabilities: { tools: {} } });
const s = (description: string, properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, description, properties, required });
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const tools = [
  { name: 'project_list', description: 'List SEO projects', inputSchema: s('No input', {}) },
  { name: 'project_snapshot', description: 'Read a compact project snapshot before deciding what to do', inputSchema: s('Project', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'keyword_list', description: 'List project keywords and their cluster assignment', inputSchema: s('Project', { projectId: { type: 'string' }, status: { type: 'string' } }, ['projectId']) },
  { name: 'keyword_create', description: 'Add a keyword to the workspace', inputSchema: s('Keyword', { projectId: { type: 'string' }, text: { type: 'string' }, source: { type: 'string' }, avgMonthly: { type: 'number' }, competition: { type: 'number' } }, ['projectId','text']) },
  { name: 'keyword_reject', description: 'Reject a keyword and optionally record the reason as a decision', inputSchema: s('Reject keyword', { projectId: { type: 'string' }, keywordId: { type: 'string' }, reason: { type: 'string' } }, ['projectId','keywordId']) },
  { name: 'cluster_list', description: 'List content clusters', inputSchema: s('Project', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'cluster_create', description: 'Create a cluster, optionally with keyword IDs', inputSchema: s('Cluster', { projectId: { type: 'string' }, title: { type: 'string' }, intent: { type: 'string' }, keywordIds: { type: 'array', items: { type: 'string' } } }, ['projectId','title']) },
  { name: 'cluster_add_keyword', description: 'Move a keyword into a cluster', inputSchema: s('Assignment', { projectId: { type: 'string' }, clusterId: { type: 'string' }, keywordId: { type: 'string' } }, ['projectId','clusterId','keywordId']) },
  { name: 'page_list', description: 'List proposed/approved/archived pages', inputSchema: s('Project', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'page_propose', description: 'Propose a page without publishing it', inputSchema: s('Page proposal', { projectId: { type: 'string' }, title: { type: 'string' }, slug: { type: 'string' }, clusterId: { type: 'string' }, kind: { type: 'string' } }, ['projectId','title']) },
  { name: 'insight_list', description: 'List agent/human insights', inputSchema: s('Project', { projectId: { type: 'string' } }, ['projectId']) },
  { name: 'insight_create', description: 'Store a research or strategy insight', inputSchema: s('Insight', { projectId: { type: 'string' }, type: { type: 'string' }, text: { type: 'string' }, confidence: { type: 'number' } }, ['projectId','type','text']) },
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
    case 'keyword_list': return text(await commands.keyword.list(ctx, a.projectId, a.status));
    case 'keyword_create': return text(await commands.keyword.create(ctx, a));
    case 'keyword_reject': return text(await commands.keyword.reject(ctx, a));
    case 'cluster_list': return text(await commands.cluster.list(ctx, a.projectId));
    case 'cluster_create': return text(await commands.cluster.create(ctx, a));
    case 'cluster_add_keyword': return text(await commands.cluster.addKeyword(ctx, a));
    case 'page_list': return text(await commands.page.list(ctx, a.projectId));
    case 'page_propose': return text(await commands.page.propose(ctx, a));
    case 'insight_list': return text(await commands.insight.list(ctx, a.projectId));
    case 'insight_create': return text(await commands.insight.create(ctx, a));
    case 'task_list': return text(await commands.task.list(ctx, a.projectId));
    case 'task_create': return text(await commands.task.create(ctx, a));
    case 'decision_record': return text(await commands.decision.record(ctx, a));
    default: throw new Error(`Unknown tool: ${request.params.name}`);
  }
});
await server.connect(new StdioServerTransport());
