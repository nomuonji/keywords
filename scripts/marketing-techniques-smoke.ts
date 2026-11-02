import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'test@example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'test' });
process.env.FIREBASE_PROJECT_ID = 'test';

const root = 'projects/test/databases/(default)/documents/';
const docs = new Map<string, any>();
let seq = 0;
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-token', expires_in: 3600 });
  assert.ok(url.startsWith('https://firestore.googleapis.com/'), `Unexpected network: ${url}`);
  const parsed = new URL(url);
  const path = parsed.pathname.replace('/v1/', '');
  const body = init?.body ? JSON.parse(String(init.body)) : null;

  if (url.endsWith(':commit')) {
    for (const write of body.writes) {
      const prev = docs.get(write.update.name);
      if (write.currentDocument?.exists === false && prev) return Response.json({}, { status: 409 });
      if (write.currentDocument?.updateTime && prev?.updateTime !== write.currentDocument.updateTime) return Response.json({}, { status: 409 });
    }
    for (const write of body.writes) docs.set(write.update.name, { ...write.update, updateTime: `rev-${++seq}` });
    return Response.json({});
  }

  if (path.endsWith('/marketingTechniques')) {
    const rows = [...docs.values()].filter(doc => doc.name.startsWith(`${root}marketingTechniques/`));
    return Response.json({ documents: rows.slice(0, Number(parsed.searchParams.get('pageSize') ?? 200)) });
  }

  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

try {
  const {
    marketingTechniqueArchive,
    marketingTechniqueGet,
    marketingTechniqueList,
    marketingTechniqueSave,
    marketingTechniqueUse
  } = await import('../packages/commands/src/marketing-techniques.ts');

  const seeded = await marketingTechniqueList({});
  assert.equal(seeded.items.length, 2, 'two builtin seeds ship with the library');
  assert.ok(seeded.items.every((item: any) => item.origin === 'builtin'));
  assert.ok(seeded.items.some((item: any) => item.name === '振るモデルチェンジ'));
  assert.match(seeded.rules.join(' '), /仮説/);

  const saved = await marketingTechniqueSave({
    name: 'カウントダウン型の希少性',
    lever: '希少性',
    category: 'コピー',
    summary: '残り時間や残数を見せて、決める理由ではなく決める期限を作る。',
    mechanism: '失う可能性は同じ大きさの得より強く動く。期限が具体的だと先送りができなくなる。',
    example: '在庫残数バッジと24時間カウントダウンを併記した販売ページ。',
    evidenceLevel: 'literature',
    sourceLabel: 'Cialdini, Influence (scarcity)',
    surfaces: ['LP', 'CTA'],
    fitWhen: '在庫や枠が実際に限られていて、その事実を確認できるとき。',
    avoidWhen: '残数の偽装。実際は無制限なのにカウントダウンを戻すと、規約違反と信用喪失になる。',
    tags: ['希少性', 'CVR']
  });
  assert.equal(saved.technique.revision, 1);
  assert.equal(saved.technique.origin, 'firestore');
  assert.equal(saved.technique.status, 'candidate');

  const detail = await marketingTechniqueGet({ id: saved.technique.id });
  assert.equal(detail.technique.name, 'カウントダウン型の希少性');
  assert.equal(detail.technique.usages.length, 0);

  const used = await marketingTechniqueUse({
    id: saved.technique.id,
    expectedRevision: 1,
    surface: '記事タイトル',
    target: '冷凍餃子の比較記事',
    note: 'タイトルに「今週中」を入れた'
  });
  assert.equal(used.technique.revision, 2);
  assert.equal(used.technique.usages.length, 1);
  assert.equal(used.technique.usages[0].surface, '記事タイトル');

  await assert.rejects(marketingTechniqueSave({
    id: saved.technique.id,
    expectedRevision: 1,
    summary: 'stale write'
  }), /Revision conflict/);

  const filtered = await marketingTechniqueList({ query: '希少性', lever: '希少性' });
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0].id, saved.technique.id);

  const archived = await marketingTechniqueArchive({ id: saved.technique.id, expectedRevision: 2, reason: '重複' });
  assert.equal(archived.technique.status, 'archived');
  const afterArchive = await marketingTechniqueList({});
  assert.ok(!afterArchive.items.some((item: any) => item.id === saved.technique.id));
  const withArchived = await marketingTechniqueList({ includeArchived: true });
  assert.ok(withArchived.items.some((item: any) => item.id === saved.technique.id));

  await assert.rejects(marketingTechniqueSave({ name: '名前だけ' }), /summary/);

  console.log('marketing technique smoke passed: builtin seeds, save, get, use, revision conflict, filter, archive');
} finally {
  globalThis.fetch = originalFetch;
}
