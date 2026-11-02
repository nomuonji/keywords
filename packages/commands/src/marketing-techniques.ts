import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { field, firestore, firestoreDocumentName, FirestoreError, value } from '../../db/src/firestore.js';
import type { MarketingTechnique, MarketingTechniqueEvidence, MarketingTechniqueStatus } from '../../db/src/remote-keyword-schema.js';

/**
 * Marketing technique library.
 *
 * The library stores observed "why this sold" mechanics — not proven rules.
 * Every entry keeps the mechanism, the concrete example, the source, and the
 * conditions under which it must not be used, so a later planning session can
 * pull a technique without re-deriving it from a screenshot or a tweet.
 */

const COLLECTION = 'marketingTechniques';
const techniqueId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const webUrl = z.string().url().refine(v => /^https?:\/\//i.test(v), 'URL must use http or https');
const text = (max: number) => z.string().trim().min(1).max(max);
const list = (max: number, itemMax = 60) => z.array(z.string().trim().min(1).max(itemMax)).max(max);
const status = z.enum(['candidate', 'usable', 'avoid', 'archived']);
const evidence = z.enum(['observed', 'reported', 'literature', 'hypothesis']);

export const marketingTechniqueListShape = {
  query: z.string().trim().min(1).max(200).optional(),
  lever: z.string().trim().min(1).max(80).optional(),
  status: status.optional(),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(100)
};

export const marketingTechniqueGetShape = { id: techniqueId };

export const marketingTechniqueSaveShape = {
  id: techniqueId.optional(),
  expectedRevision: z.number().int().min(0).default(0),
  name: text(120).optional(),
  lever: text(80).optional(),
  category: text(80).optional(),
  summary: text(600).optional(),
  mechanism: text(3000).optional(),
  example: z.string().trim().max(3000).optional(),
  evidenceLevel: evidence.optional(),
  sourceUrl: webUrl.nullable().optional(),
  sourceLabel: z.string().trim().max(300).nullable().optional(),
  observedAt: isoDate.nullable().optional(),
  surfaces: list(20, 40).optional(),
  fitWhen: z.string().trim().max(1200).optional(),
  avoidWhen: z.string().trim().max(1200).optional(),
  tags: list(30, 40).optional(),
  status: status.optional()
};

export const marketingTechniqueUseShape = {
  id: techniqueId,
  expectedRevision: z.number().int().min(0),
  surface: text(120),
  target: text(300),
  note: z.string().trim().max(1000).default(''),
  usedAt: isoDate.optional()
};

export const marketingTechniqueArchiveShape = {
  id: techniqueId,
  expectedRevision: z.number().int().min(0),
  reason: z.string().trim().min(1).max(500)
};

function fields(data: object) {
  return Object.fromEntries(Object.entries(data).filter(([, item]) => item !== undefined).map(([key, item]) => [key, field(item)]));
}
function parseDoc<T>(doc: any): T {
  return { id: String(doc.name ?? '').split('/').pop() ?? '', ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)])) } as T;
}
function nowIso() { return new Date().toISOString(); }
function unique(items: string[]) { return [...new Set(items.map(x => x.trim()).filter(Boolean))]; }
function norm(word: string) { return word.normalize('NFKC').toLowerCase(); }

function normalize(technique: Omit<MarketingTechnique, 'origin'>, origin: MarketingTechnique['origin']): MarketingTechnique {
  return {
    ...technique,
    lever: technique.lever ?? '未分類',
    category: technique.category ?? 'クリエイティブ',
    summary: technique.summary ?? '',
    mechanism: technique.mechanism ?? '',
    example: technique.example ?? '',
    evidenceLevel: technique.evidenceLevel ?? 'observed',
    sourceUrl: technique.sourceUrl ?? null,
    sourceLabel: technique.sourceLabel ?? null,
    observedAt: technique.observedAt ?? null,
    surfaces: unique(technique.surfaces ?? []),
    fitWhen: technique.fitWhen ?? '',
    avoidWhen: technique.avoidWhen ?? '',
    tags: unique(technique.tags ?? []),
    status: technique.status ?? 'candidate',
    usages: technique.usages ?? [],
    revision: Number(technique.revision ?? 0),
    createdAt: technique.createdAt,
    updatedAt: technique.updatedAt,
    origin
  };
}

/**
 * Seeds ship with the code so the library is never empty on a fresh install.
 * A Firestore record with the same id overrides the seed; observed facts and
 * the source stay attached to the entry either way.
 */
const BUILTIN_TECHNIQUES: MarketingTechnique[] = [
  normalize({
    id: 'tech-subliminal-sexual-cue',
    name: 'サブリミナル的・性的訴求',
    lever: '性的訴求',
    category: 'クリエイティブ',
    summary: '性的な記号を主役にせず、構図の端・服装・一瞬のカットに混ぜて「なぜか目が行く」状態を作る。',
    mechanism: '直接的な表現を避けると、視聴者は理由を言葉にできないまま注意を引かれる。説明できない違和感が記憶に残り、普通のプロモより粘る（クセになる誘引力）。',
    example: 'モデルが商品を振るCM。性的な要素を全面に出さず、画面の端や服装のディテールに配置して視線を留めた、という観測（@saika_affi の投稿）。',
    evidenceLevel: 'reported',
    sourceUrl: 'https://x.com/saika_affi',
    sourceLabel: '@saika_affi / X',
    observedAt: '2026-11-02',
    surfaces: ['サムネイル', '動画', 'バナー'],
    fitWhen: '商品の機能差が小さく、注意と記憶の獲得だけが勝負になる場面。',
    avoidWhen: '年齢制限・広告審査・プラットフォームポリシー・ブランド毀損のリスク。医薬品・金融・公共性の高い商材、法人向けの信頼商材では使わない。',
    tags: ['クリエイティブ', '注意', '記憶', '性的訴求'],
    status: 'candidate',
    usages: [],
    revision: 0,
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z'
  }, 'builtin'),
  normalize({
    id: 'tech-shake-model-change',
    name: '振るモデルチェンジ',
    lever: '意外性',
    category: '商品',
    summary: '中身がほぼ同じでも、使い方や所作を1つ足して「新商品」として売り直す。',
    mechanism: '既存カテゴリの説明コストをゼロにしたまま、覚える動作を1つだけ増やす。差分が1つなので真似しやすく、口コミでも一言で伝わる。',
    example: 'ドリトッチ。ココアと牛乳という普通の組み合わせを「振る」という動作で商品化し、年間売上100億円規模の記録を作ったと投稿で語られている（@saika_affi）。',
    evidenceLevel: 'reported',
    sourceUrl: 'https://x.com/saika_affi',
    sourceLabel: '@saika_affi / X（2022-12-28の投稿。個別ポストURLは未記録）',
    observedAt: '2022-12-28',
    surfaces: ['商品名', 'パッケージ', 'SNS', '動画'],
    fitWhen: '既存カテゴリに説明不要の商品があり、差別化要素を1つに絞れるとき。',
    avoidWhen: '「振る」動作が実際の品質や使い勝手を悪くする場合。中身が同じことの説明を省くと、リピート後に不満として返る。',
    tags: ['商品設計', '意外性', '口コミ'],
    status: 'candidate',
    usages: [],
    revision: 0,
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z'
  }, 'builtin')
];

async function readDocument(id: string) {
  try { return await firestore(`/${COLLECTION}/${techniqueId.parse(id)}`); }
  catch (error) { if (error instanceof FirestoreError && error.status === 404) return null; throw error; }
}

async function storedTechniques(): Promise<MarketingTechnique[]> {
  const documents: any[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = await firestore(`/${COLLECTION}?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    documents.push(...(result.documents ?? []));
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }
  return documents.map(doc => normalize(parseDoc<MarketingTechnique>(doc), 'firestore'));
}

async function allTechniques() {
  const byId = new Map<string, MarketingTechnique>();
  for (const item of BUILTIN_TECHNIQUES) byId.set(item.id, item);
  for (const item of await storedTechniques()) byId.set(item.id, item);
  return [...byId.values()];
}

function matches(item: MarketingTechnique, query: string) {
  const haystack = norm([item.name, item.lever, item.category, item.summary, item.mechanism, item.example, item.fitWhen, ...item.tags].join(' '));
  const needles = norm(query).split(/\s+/).filter(Boolean);
  return needles.every(needle => haystack.includes(needle));
}

function techniqueIdFor(name: string) {
  return 'tech_' + createHash('sha256').update(norm(name)).digest('hex').slice(0, 12);
}

export async function marketingTechniqueList(input: unknown = {}) {
  const args = z.object(marketingTechniqueListShape).strict().parse(input);
  let items = (await allTechniques())
    .filter(item => args.includeArchived || item.status !== 'archived')
    .filter(item => !args.status || item.status === args.status)
    .filter(item => !args.lever || item.lever === args.lever)
    .filter(item => !args.query || matches(item, args.query));
  items = items
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, args.limit);

  const levers = new Map<string, number>();
  for (const item of items) levers.set(item.lever, (levers.get(item.lever) ?? 0) + 1);
  return {
    generatedAt: nowIso(),
    mission: 'Collect observed marketing mechanics with their mechanism, source and no-go conditions, so planning starts from remembered practice instead of re-deriving it from a screenshot.',
    rules: [
      '証拠レベルを分けて保存する。観測していない効果を observed にしない。',
      '出典URLのない噂は hypothesis として置き、事実として引用しない。',
      'avoidWhen を必ず書く。使ってはいけない条件のない手法は登録しない。',
      'この一覧は仮説であって、そのまま成果を約束するものではない。'
    ],
    items,
    total: items.length,
    levers: [...levers.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  };
}

export async function marketingTechniqueGet(input: unknown) {
  const args = z.object(marketingTechniqueGetShape).strict().parse(input);
  const stored = await readDocument(args.id);
  const item = stored ? normalize(parseDoc<MarketingTechnique>(stored), 'firestore') : BUILTIN_TECHNIQUES.find(v => v.id === args.id);
  if (!item) throw new Error('Marketing technique not found');
  return { technique: item };
}

export async function marketingTechniqueSave(input: unknown) {
  const args = z.object(marketingTechniqueSaveShape).strict().parse(input);
  const existingDoc = args.id ? await readDocument(args.id) : null;
  const builtin = args.id ? BUILTIN_TECHNIQUES.find(item => item.id === args.id) ?? null : null;
  const existing = existingDoc ? normalize(parseDoc<MarketingTechnique>(existingDoc), 'firestore') : builtin;
  const actualRevision = existingDoc ? existing!.revision : 0;
  if (actualRevision !== args.expectedRevision) throw new Error('Revision conflict: call technique_get and reapply the update');

  const name = args.name ?? existing?.name;
  if (!name) throw new Error('New techniques require a name');
  const summary = args.summary ?? existing?.summary;
  if (!summary) throw new Error('New techniques require a summary');
  const mechanism = args.mechanism ?? existing?.mechanism;
  if (!mechanism) throw new Error('New techniques require a mechanism');

  const t = nowIso();
  const id = args.id ?? techniqueIdFor(name);
  const next: MarketingTechnique = normalize({
    id,
    name,
    lever: args.lever ?? existing?.lever ?? '未分類',
    category: args.category ?? existing?.category ?? 'クリエイティブ',
    summary,
    mechanism,
    example: args.example ?? existing?.example ?? '',
    evidenceLevel: (args.evidenceLevel ?? existing?.evidenceLevel ?? 'observed') as MarketingTechniqueEvidence,
    sourceUrl: args.sourceUrl !== undefined ? args.sourceUrl : existing?.sourceUrl ?? null,
    sourceLabel: args.sourceLabel !== undefined ? args.sourceLabel : existing?.sourceLabel ?? null,
    observedAt: args.observedAt !== undefined ? args.observedAt : existing?.observedAt ?? null,
    surfaces: args.surfaces ?? existing?.surfaces ?? [],
    fitWhen: args.fitWhen ?? existing?.fitWhen ?? '',
    avoidWhen: args.avoidWhen ?? existing?.avoidWhen ?? '',
    tags: args.tags ?? existing?.tags ?? [],
    status: (args.status ?? existing?.status ?? 'candidate') as MarketingTechniqueStatus,
    usages: existing?.usages ?? [],
    revision: actualRevision + 1,
    createdAt: existingDoc ? existing!.createdAt : builtin?.createdAt ?? t,
    updatedAt: t
  }, 'firestore');

  const runId = randomUUID();
  await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes: [
    {
      update: { name: firestoreDocumentName(`${COLLECTION}/${next.id}`), fields: fields(next) },
      currentDocument: existingDoc ? { updateTime: existingDoc.updateTime } : { exists: false }
    },
    {
      update: { name: firestoreDocumentName(`runs/${runId}`), fields: fields({ id: runId, command: 'marketing_technique_save', targetId: next.id, actor: 'agent_or_owner', createdAt: t, outcome: 'succeeded' }) },
      currentDocument: { exists: false }
    }
  ] }) });
  return { technique: next, runId };
}

export async function marketingTechniqueUse(input: unknown) {
  const args = z.object(marketingTechniqueUseShape).strict().parse(input);
  const stored = await readDocument(args.id);
  const builtin = BUILTIN_TECHNIQUES.find(item => item.id === args.id) ?? null;
  const existing = stored ? normalize(parseDoc<MarketingTechnique>(stored), 'firestore') : builtin;
  if (!existing) throw new Error('Marketing technique not found');
  const actualRevision = stored ? existing.revision : 0;
  if (actualRevision !== args.expectedRevision) throw new Error('Revision conflict: call technique_get and reapply the update');

  const t = nowIso();
  const next: MarketingTechnique = normalize({
    ...existing,
    usages: [...(existing.usages ?? []), { at: args.usedAt ?? t.slice(0, 10), surface: args.surface, target: args.target, note: args.note }].slice(-50),
    revision: actualRevision + 1,
    updatedAt: t
  }, 'firestore');

  const runId = randomUUID();
  await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes: [
    {
      update: { name: firestoreDocumentName(`${COLLECTION}/${next.id}`), fields: fields(next) },
      currentDocument: stored ? { updateTime: stored.updateTime } : { exists: false }
    },
    {
      update: { name: firestoreDocumentName(`runs/${runId}`), fields: fields({ id: runId, command: 'marketing_technique_use', targetId: next.id, actor: 'agent_or_owner', createdAt: t, outcome: 'succeeded' }) },
      currentDocument: { exists: false }
    }
  ] }) });
  return { technique: next, runId };
}

export async function marketingTechniqueArchive(input: unknown) {
  const args = z.object(marketingTechniqueArchiveShape).strict().parse(input);
  const stored = await readDocument(args.id);
  const builtin = BUILTIN_TECHNIQUES.find(item => item.id === args.id) ?? null;
  const existing = stored ? normalize(parseDoc<MarketingTechnique>(stored), 'firestore') : builtin;
  if (!existing) throw new Error('Marketing technique not found');
  const actualRevision = stored ? existing.revision : 0;
  if (actualRevision !== args.expectedRevision) throw new Error('Revision conflict: call technique_get and reapply the update');

  const t = nowIso();
  const next: MarketingTechnique = normalize({
    ...existing,
    status: 'archived',
    revision: actualRevision + 1,
    updatedAt: t
  }, 'firestore');

  const runId = randomUUID();
  await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes: [
    {
      update: { name: firestoreDocumentName(`${COLLECTION}/${next.id}`), fields: fields(next) },
      currentDocument: stored ? { updateTime: stored.updateTime } : { exists: false }
    },
    {
      update: { name: firestoreDocumentName(`runs/${runId}`), fields: fields({ id: runId, command: 'marketing_technique_archive', targetId: next.id, reason: args.reason, actor: 'agent_or_owner', createdAt: t, outcome: 'succeeded' }) },
      currentDocument: { exists: false }
    }
  ] }) });
  return { technique: next, runId };
}
