import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import * as z from 'zod/v4';
// Keep this import relative: Vercel bundles a root-level serverless function
// independently of npm workspace links.
import { keywordDemand, treasuryConfiguration, treasuryList, treasurySave } from '../packages/keyword-treasury/src/index.js';

const app = new Hono();
const token = process.env.KEYWORDS_REMOTE_MCP_TOKEN?.trim();
if (!token) throw new Error('KEYWORDS_REMOTE_MCP_TOKEN is required for the remote MCP');
const origin = process.env.KEYWORDS_REMOTE_MCP_ALLOWED_ORIGIN?.trim() || '*';
app.use('*', cors({ origin, allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Protocol-Version'], exposeHeaders: ['Mcp-Protocol-Version'] }));
const requireToken = async (c: any, next: any) => {
  const supplied = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (supplied !== token) return c.json({ error: 'Unauthorized' }, 401);
  return next();
};
app.use('/mcp', requireToken);
app.use('/api/mcp', requireToken);
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
function server() {
  const mcp = new McpServer({ name: 'keywords-treasury', version: '1.0.0' });
  mcp.registerTool('remote_keyword_status', { description: 'Check whether the remote keyword treasury, Firestore, and demand provider are configured. No secrets are returned.' }, async () => text(treasuryConfiguration()));
  mcp.registerTool('keyword_demand_research', { description: 'Get Google Ads keyword demand metrics through the configured provider. This only researches; it does not save candidates.', inputSchema: { keywords: z.array(z.string().min(1)).min(1).max(50), languageConstant: z.string().optional(), geoTargetConstants: z.array(z.string()).optional(), includeAdultKeywords: z.boolean().optional() } }, async input => text(await keywordDemand(input)));
  mcp.registerTool('keyword_treasury_save', { description: 'Save evidence-backed niche keyword candidates to the shared Firestore treasury. Use after judging demand and competition; do not save speculative phrases without evidence.', inputSchema: { candidates: z.array(z.object({ keyword: z.string().min(1), seed: z.string().optional(), status: z.enum(['inbox', 'shortlisted', 'rejected', 'published']).optional(), notes: z.string().max(4000).optional(), volume: z.number().nullable().optional(), competition: z.union([z.string(), z.number()]).nullable().optional(), allintitle: z.number().nullable().optional(), serpWeakness: z.number().nullable().optional(), source: z.string().optional(), evidence: z.record(z.string(), z.unknown()).optional() })).min(1).max(100) } }, async ({ candidates }) => text(await treasurySave(candidates)));
  mcp.registerTool('keyword_treasury_list', { description: 'List keyword candidates saved in the shared Firestore treasury.', inputSchema: { status: z.enum(['inbox', 'shortlisted', 'rejected', 'published']).optional(), query: z.string().optional(), limit: z.number().min(1).max(100).optional() } }, async input => text(await treasuryList(input)));
  return mcp;
}
const health = (c: any) => c.json({ ok: true, service: 'keywords-treasury-mcp', ...treasuryConfiguration() });
const handleMcp = async (c: any) => { const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true }); const instance = server(); await instance.connect(transport); return transport.handleRequest(c.req.raw); };
app.get('/health', health); app.get('/mcp/health', health); app.get('/api/mcp/health', health);
app.all('/mcp', handleMcp); app.all('/api/mcp', handleMcp);
export default app;
