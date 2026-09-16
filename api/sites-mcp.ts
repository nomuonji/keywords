import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { SITES_MCP_SERVER_VERSION, SITES_MCP_TOOL_NAMES } from './sites-mcp-contract.js';
import {
  metricSnapshotList, metricSnapshotListShape, metricSnapshotSave, metricSnapshotSaveShape,
  optimizationContext, optimizationContextShape,
  optimizationEventCreate, optimizationEventCreateShape, optimizationEventList, optimizationEventListShape, optimizationEventUpdate, optimizationEventUpdateShape,
  remoteSitesStatus,
  siteArticleGet, siteArticleGetShape, siteArticleList, siteArticleListShape, siteArticleSave, siteArticleSaveShape,
  siteRegistryGet, siteRegistryGetShape, siteRegistryList, siteRegistryListShape, siteRegistrySave, siteRegistrySaveShape
} from '../packages/commands/src/remote-site-operations.js';

const app = new Hono();
const configuredToken = process.env.KEYWORDS_REMOTE_MCP_TOKEN?.trim();
if (!configuredToken) throw new Error('KEYWORDS_REMOTE_MCP_TOKEN is required for the Sites Operator remote MCP');
const token: string = configuredToken;
const corsOrigin = process.env.KEYWORDS_REMOTE_MCP_ALLOWED_ORIGIN?.trim() || '*';

app.use('*', cors({ origin: corsOrigin, allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Protocol-Version'], exposeHeaders: ['Mcp-Protocol-Version'] }));
function origin(c: any) { return new URL(c.req.url).origin; }
function unb64(value: string) { return Buffer.from(value, 'base64url').toString('utf8'); }
function verified(value: string, kind: string) {
  const [body, signature] = value.split('.'); if (!body || !signature) return null;
  const expected = createHmac('sha256', token).update(body).digest('base64url');
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try { const payload = JSON.parse(unb64(body)); return payload.kind === kind && typeof payload.exp === 'number' && payload.exp > Math.floor(Date.now() / 1000) ? payload : null; } catch { return null; }
}
function sameSecret(value: string) { return value.length === token.length && timingSafeEqual(Buffer.from(value), Buffer.from(token)); }
function isAuthorized(value: string) { return sameSecret(value) || Boolean(verified(value, 'access')); }
const requireToken = async (c: any, next: any) => {
  const supplied = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  // Reuse the existing Keywords OAuth authorization server and its signed access
  // tokens. This keeps one secret and one Firebase project while MCP duties stay separate.
  if (!isAuthorized(supplied)) {
    c.header('WWW-Authenticate', `Bearer resource_metadata="${origin(c)}/.well-known/oauth-protected-resource"`);
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
};
app.use('/sites-mcp', requireToken); app.use('/api/sites-mcp', requireToken);

const structured = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: Array.isArray(value) ? { items: value } : value && typeof value === 'object' ? value as Record<string, unknown> : { value }
});
function runtimeStatus() {
  return {
    ...remoteSitesStatus(),
    serverVersion: SITES_MCP_SERVER_VERSION,
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.COMMIT_SHA ?? null,
    deployment: {
      platform: process.env.VERCEL ? 'vercel' : 'unknown',
      environment: process.env.VERCEL_ENV ?? null,
      url: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? null
    },
    toolCount: SITES_MCP_TOOL_NAMES.length,
    tools: [...SITES_MCP_TOOL_NAMES]
  };
}

function server() {
  const mcp = new McpServer({ name: 'sites-operator', version: SITES_MCP_SERVER_VERSION });
  mcp.registerTool('remote_sites_status', { description: 'Check Sites Operator version, deployment, source-of-truth policy, Firestore configuration and tool contract. No secrets are returned.' }, async () => structured(runtimeStatus()));
  mcp.registerTool('site_registry_list', { description: 'List real deployed/building sites. Site Concepts remain separate planning records in siteStructures.', inputSchema: siteRegistryListShape, annotations: { readOnlyHint: true } }, async input => structured(await siteRegistryList(input)));
  mcp.registerTool('site_registry_get', { description: 'Read one real site and its repository, production URL, deployment provider and analytics identifiers.', inputSchema: siteRegistryGetShape, annotations: { readOnlyHint: true } }, async input => structured(await siteRegistryGet(input)));
  mcp.registerTool('site_registry_save', { description: 'Create or update a real site with optimistic revision control. This does not create or edit a Site Concept.', inputSchema: siteRegistrySaveShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await siteRegistrySave(input)));
  mcp.registerTool('site_article_list', { description: 'List article registry records for a real site. Article bodies remain in Git and are never returned from Firestore.', inputSchema: siteArticleListShape, annotations: { readOnlyHint: true } }, async input => structured(await siteArticleList(input)));
  mcp.registerTool('site_article_get', { description: 'Read one article registry record including repoPath/currentCommitSha and keyword links, without article body text.', inputSchema: siteArticleGetShape, annotations: { readOnlyHint: true } }, async input => structured(await siteArticleGet(input)));
  mcp.registerTool('site_article_save', { description: 'Create or update an article registry record with optimistic revision control. The Git repository remains the content source of truth.', inputSchema: siteArticleSaveShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await siteArticleSave(input)));
  mcp.registerTool('site_metric_snapshot_save', { description: 'Persist an idempotent GSC or GA4 period snapshot. Daily collection is allowed; missing/partial data is represented explicitly rather than converted to zero.', inputSchema: metricSnapshotSaveShape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } }, async input => structured(await metricSnapshotSave(input)));
  mcp.registerTool('site_metric_snapshot_list', { description: 'List recent GSC/GA4 snapshots for a site or article.', inputSchema: metricSnapshotListShape, annotations: { readOnlyHint: true } }, async input => structured(await metricSnapshotList(input)));
  mcp.registerTool('optimization_event_create', { description: 'Persist one SEO hypothesis/change event. Only one implemented, unevaluated change may exist per article.', inputSchema: optimizationEventCreateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await optimizationEventCreate(input)));
  mcp.registerTool('optimization_event_list', { description: 'List persisted SEO observations, hypotheses, changes and outcomes.', inputSchema: optimizationEventListShape, annotations: { readOnlyHint: true } }, async input => structured(await optimizationEventList(input)));
  mcp.registerTool('optimization_event_update', { description: 'Mark a hypothesis implemented/evaluated/cancelled with optimistic revision control. An implemented change defaults to a 14-day evaluation wait and cannot be scored early.', inputSchema: optimizationEventUpdateShape, annotations: { readOnlyHint: false, destructiveHint: false } }, async input => structured(await optimizationEventUpdate(input)));
  mcp.registerTool('optimization_context', { description: 'Read latest GSC/GA4 observations plus the active hypothesis/cooldown before changing an article.', inputSchema: optimizationContextShape, annotations: { readOnlyHint: true } }, async input => structured(await optimizationContext(input)));
  return mcp;
}

const health = (c: any) => c.json({ ok: true, service: 'sites-operator-mcp', ...runtimeStatus() });
const handleMcp = async (c: any) => { const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true }); const instance = server(); await instance.connect(transport); return transport.handleRequest(c.req.raw); };
app.get('/health', health); app.get('/sites-mcp/health', health); app.get('/api/sites-mcp/health', health);
app.all('/sites-mcp', handleMcp); app.all('/api/sites-mcp', handleMcp);
export default app;
