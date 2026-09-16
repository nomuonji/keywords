import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { siteStructureSave, siteStructureGet, siteStructureList, siteStructurePatch } from '../packages/commands/src/site-structure.js';
import { field } from '../packages/db/src/firestore.js';

// Exercise command + transport + MCP against a deterministic Firestore double.
// Never loads .env or touches real research/site data.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'test@example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'test' });
process.env.FIREBASE_PROJECT_ID = 'test';
process.env.KEYWORDS_REMOTE_MCP_TOKEN = 'test-only-token';
const root = 'projects/test/databases/(default)/documents/';
const docs = new Map<string, any>();
const keywordId = 'a'.repeat(32);
docs.set(`${root}keywordTreasury/${keywordId}`, { name: `${root}keywordTreasury/${keywordId}`, fields: { keyword: field('調査済みKW'), volume: field(100) } });
let sequence = 0;
let failCommit = false;
let failRead = false;
let commits = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
  assert.ok(url.startsWith('https://firestore.googleapis.com/'), `Unexpected network: ${url}`);
  const path = new URL(url).pathname.replace('/v1/', '');
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (url.endsWith(':commit')) {
    if (failCommit) return Response.json({}, { status: 503 });
    for (const write of body.writes) {
      const previous = docs.get(write.update.name);
      if ((write.currentDocument.exists === false && previous) || (write.currentDocument.updateTime && previous?.updateTime !== write.currentDocument.updateTime)) return Response.json({}, { status: 409 });
    }
    for (const write of body.writes) docs.set(write.update.name, { ...write.update, updateTime: `revision-${++sequence}` });
    commits++;
    return Response.json({});
  }
  if (url.endsWith(':batchGet')) return Response.json(body.documents.map((name: string) => docs.has(name) ? { found: docs.get(name) } : { missing: name }));
  if (path.endsWith('/siteStructures')) {
    const params = new URL(url).searchParams;
    const all = [...docs.values()].filter(doc => doc.name.startsWith(`${root}siteStructures/`)).sort((a, b) => b.fields.updatedAt.stringValue.localeCompare(a.fields.updatedAt.stringValue));
    const offset = Number(params.get('pageToken') ?? 0), size = Number(params.get('pageSize'));
    return Response.json({ documents: all.slice(offset, offset + size), ...(offset + size < all.length ? { nextPageToken: String(offset + size) } : {}) });
  }
  if (failRead) return Response.json({}, { status: 403 });
  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

try {
  const home = { id: 'home', parentId: null, title: 'トップ', path: '/', kind: 'home' as const, keywordIds: [keywordId], keywordRoles: { [keywordId]: 'primary' as const } };
  const article = { id: 'article', parentId: 'home', title: '記事', path: '/article', kind: 'article' as const };
  const created = await siteStructureSave({
    id: 'test-site', expectedRevision: 0, title: '構想', audience: '読者', nodes: [home, article], links: [{ from: 'home', to: 'article', label: '詳しく' }],
    dataModel: [{ entity: 'product', fields: [{ name: 'price', type: 'number', description: '月額', required: true }] }],
    sourceStrategy: [{ name: '公式料金', sourceType: 'official_pricing', urlPattern: '/pricing', fields: ['price'] }],
    pageTemplates: [{ id: 'detail', titlePattern: '{product} 料金・機能', kind: 'detail', dataRequirements: ['price'] }],
    refreshPolicy: [{ scope: 'price', ttlDays: 30, trigger: 'scheduled' }]
  });
  assert.equal(created.revision, 1);
  assert.ok(docs.has(`${root}runs/${created.runId}`));
  const initial = await siteStructureGet({ id: 'test-site' });
  assert.equal(initial.keywords[0]?.keyword, '調査済みKW');
  assert.equal(initial.dataModel[0]?.entity, 'product');
  assert.equal(initial.nodes[0]?.keywordRoles[keywordId], 'primary');

  const edited = await siteStructureSave({ id: 'test-site', expectedRevision: 1, concept: '編集した構想' });
  assert.equal(edited.title, '構想'); assert.equal(edited.nodes.length, 2); assert.equal(edited.audience, '読者');
  assert.equal(edited.createdAt, created.createdAt); assert.equal(edited.revision, 2);
  assert.equal(edited.dataModel[0]?.entity, 'product');

  const patched = await siteStructurePatch({ id: 'test-site', expectedRevision: 2, operations: [
    { op: 'addNode', node: { id: 'pricing', parentId: 'home', title: '料金比較', path: '/pricing', kind: 'category' } },
    { op: 'addLink', link: { from: 'home', to: 'pricing', label: '料金' } },
    { op: 'linkKeyword', nodeId: 'pricing', keywordId, role: 'monetization' }
  ] });
  assert.equal(patched.revision, 3);
  assert.equal(patched.nodes.length, 3);
  assert.equal(patched.nodes.find(node => node.id === 'pricing')?.keywordRoles[keywordId], 'monetization');
  assert.equal(patched.title, '構想');
  assert.equal(patched.dataModel[0]?.entity, 'product');

  const patchedAgain = await siteStructurePatch({ id: 'test-site', expectedRevision: 3, operations: [
    { op: 'updateNode', id: 'pricing', title: '料金・プラン比較' },
    { op: 'unlinkKeyword', nodeId: 'pricing', keywordId },
    { op: 'removeLink', from: 'home', to: 'pricing' },
    { op: 'removeNode', id: 'pricing' }
  ] });
  assert.equal(patchedAgain.revision, 4);
  assert.equal(patchedAgain.nodes.length, 2);
  assert.equal(patchedAgain.title, '構想');
  assert.equal(patchedAgain.dataModel[0]?.entity, 'product');

  await assert.rejects(siteStructureSave({ id: 'test-site', expectedRevision: 1, title: '古い更新' }), /Revision conflict/);
  await assert.rejects(siteStructureSave({ id: '../bad', expectedRevision: 0, title: 'bad' }));
  await assert.rejects(siteStructureSave({ id: 'missing-title', expectedRevision: 0 }), /title is required/);
  const edit = (patch: object) => siteStructureSave({ id: 'test-site', expectedRevision: 4, ...patch });
  await assert.rejects(edit({ nodes: [home, home] }), /IDs must be unique/);
  await assert.rejects(edit({ nodes: [home, { ...article, path: '/' }] }), /paths must be unique/);
  await assert.rejects(edit({ nodes: [home, { ...article, parentId: 'missing' }] }), /Unknown parent/);
  await assert.rejects(edit({ nodes: [{ ...home, parentId: 'article' }, article] }), /cycle/);
  await assert.rejects(edit({ nodes: [home] }), /existing pages/);
  await assert.rejects(edit({ nodes: [{ ...home, keywordIds: ['b'.repeat(32)] }, article] }), /Unknown treasury/);
  await assert.rejects(edit({ links: [{ from: 'home', to: 'home' }] }), /different existing pages/);
  await assert.rejects(edit({ nodes: [{ ...home, path: 'https://example.com' }] }));
  await assert.rejects(edit({ status: 'published' }));
  const beforeFailure = commits;
  failCommit = true;
  await assert.rejects(edit({ concept: '失敗' }), /503/);
  failCommit = false;
  assert.equal(commits, beforeFailure);
  assert.equal((await siteStructureGet({ id: 'test-site' })).revision, 4);
  failRead = true;
  await assert.rejects(edit({ concept: '権限なし' }), /403/);
  failRead = false;
  const concurrent = await Promise.allSettled([edit({ concept: 'A' }), edit({ concept: 'B' })]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await siteStructureGet({ id: 'test-site' })).revision, 5);
  await siteStructureSave({ id: 'test-site', expectedRevision: 5, status: 'archived', nodes: [], links: [] });
  assert.equal((await siteStructureGet({ id: 'test-site' })).nodes.length, 0);
  await siteStructureSave({ id: 'second', title: '2', expectedRevision: 0 });
  const page = await siteStructureList({ limit: 1 });
  assert.ok(page.nextPageToken);
  const next = await siteStructureList({ limit: 1, pageToken: page.nextPageToken });
  assert.notEqual(page.items[0].id, next.items[0].id);
  assert.equal(next.nextPageToken, null);
  await assert.rejects(siteStructureList({ limit: -1 }));
  const { default: publicApi } = await import('../api/site-structures.js');
  assert.equal((await publicApi.request('/api/site-structures')).status, 200);
  assert.equal((await publicApi.request('/api/site-structures?id=unknown')).status, 404);
  assert.equal((await publicApi.request('/api/site-structures?id=../bad')).status, 400);
  assert.equal((await publicApi.request('/api/site-structures', { method: 'POST', body: '{}' })).status, 404);
  const { default: mcp } = await import('../api/mcp.js');
  assert.equal((await mcp.request('/mcp', { method: 'POST' })).status, 401);
  const call = async (method: string, params: object) => {
    const response = await mcp.request('/mcp', { method: 'POST', headers: { authorization: 'Bearer test-only-token', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    assert.equal(response.status, 200);
    return (await response.json() as any).result;
  };
  const listing = await call('tools/list', {});
  assert.equal(listing.tools.length, 18);
  assert.ok(listing.tools.some((tool: any) => tool.name === 'site_structure_patch' && tool.inputSchema.properties.expectedRevision));
  const saved = await call('tools/call', { name: 'site_structure_save', arguments: { id: 'via-mcp', title: 'MCPから作成', expectedRevision: 0 } });
  assert.ok(!saved.isError, JSON.stringify(saved));
  assert.equal(JSON.parse(saved.content[0].text).revision, 1);
  assert.equal(saved.structuredContent.revision, 1);
  const read = await call('tools/call', { name: 'site_structure_get', arguments: { id: 'via-mcp' } });
  assert.equal(JSON.parse(read.content[0].text).title, 'MCPから作成');
  const conflict = await call('tools/call', { name: 'site_structure_save', arguments: { id: 'via-mcp', title: 'overwrite', expectedRevision: 0 } });
  assert.equal(conflict.isError, true);
  assert.equal([...docs.values()].filter(doc => doc.name.startsWith(`${root}runs/`)).length, commits);
  console.log('site structure smoke passed: rich concept metadata, patch operations, graph validation, audit, revisions, pagination and structured MCP output');
} finally { globalThis.fetch = originalFetch; }
