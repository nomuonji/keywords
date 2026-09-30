import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { field, firestore, firestoreDocumentName, FirestoreError, value } from '../../db/src/firestore.js';
import type { SeoSource, SeoSourceScan } from '../../db/src/remote-keyword-schema.js';

const sourceId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const sourceType = z.enum(['x_account', 'website', 'newsletter', 'youtube', 'other']);
const sourceStatus = z.enum(['active', 'paused', 'archived']);
const scanOutcome = z.enum(['useful', 'mixed', 'nothing_new', 'needs_followup', 'unavailable']);
const disposition = z.enum(['candidate', 'adopted', 'rejected', 'watch']);
const confidence = z.enum(['low', 'low_to_medium', 'medium', 'medium_to_high', 'high']);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoTime = z.string().datetime({ offset: true });
const webUrl = z.string().url().refine(v => /^https?:\/\//i.test(v), 'URL must use http or https');
const short = z.string().trim().min(1).max(4000);

const findingShape = z.object({
  url: webUrl,
  publishedAt: isoTime.nullable().optional(),
  claimSummary: z.string().trim().min(1).max(2000),
  relevance: z.string().trim().min(1).max(2000),
  disposition,
  confidence,
  verificationNeeded: z.boolean().default(true),
  evaluatorIds: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  notes: z.string().max(2000).default('')
}).strict();

export const seoSourcePoolContextShape = {
  sourceType: sourceType.optional(),
  topic: z.string().trim().min(1).max(120).optional(),
  includePaused: z.boolean().default(false),
  includeArchived: z.boolean().default(false),
  staleAfterDays: z.number().int().min(1).max(365).default(14),
  scanLimitPerSource: z.number().int().min(1).max(20).default(3)
};

export const seoSourceGetShape = { id: sourceId, scanLimit: z.number().int().min(1).max(50).default(10) };

export const seoSourceSaveShape = {
  id: sourceId,
  expectedRevision: z.number().int().min(0),
  sourceType: sourceType.optional(),
  label: z.string().trim().min(1).max(300).optional(),
  canonicalUrl: webUrl.optional(),
  handle: z.string().trim().min(1).max(200).nullable().optional(),
  topics: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  whyWatch: z.string().max(4000).optional(),
  trustNotes: z.string().max(4000).optional(),
  notes: z.string().max(4000).optional(),
  status: sourceStatus.optional(),
  reviewCadenceDays: z.number().int().min(1).max(365).optional()
};

export const seoSourceScanRecordShape = {
  sourceId,
  reviewedAt: isoTime.optional(),
  periodStart: isoDate.nullable().optional(),
  periodEnd: isoDate.nullable().optional(),
  outcome: scanOutcome,
  summary: short,
  retrievalMethod: z.string().trim().min(1).max(200).default('public_web'),
  limitations: z.array(z.string().trim().min(1).max(1000)).max(30).default([]),
  findings: z.array(findingShape).max(30).default([]),
  actor: z.string().trim().min(1).max(120).default('chatgpt')
};

const BUILTIN_SOURCES: SeoSource[] = [
  {
    id: 'x_ezayan',
    sourceType: 'x_account',
    label: '江沢真紀 / @ezayan',
    canonicalUrl: 'https://x.com/ezayan',
    handle: '@ezayan',
    topics: ['seo', 'database_seo', 'site_structure', 'crawl_indexing', 'keyword_design', 'cannibalization'],
    whyWatch: '長年のSEO実務経験があり、DB型サイト・キーワード設計・カテゴリ設計・クロール/インデックスなど、Sites Operatorの設計判断に直結する具体論を継続発信しているため。',
    trustNotes: '実務家の観測・経験として有用だが、Google公式見解ではない。重要な一般化やランキング要因の主張は一次情報または独立した実測で再確認する。',
    notes: 'User-seeded source. Built-in seed can be overridden by a Firestore record with the same ID.',
    status: 'active',
    reviewCadenceDays: 7,
    revision: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    origin: 'builtin'
  }
];

function fields(data: object) {
  return Object.fromEntries(Object.entries(data).filter(([, item]) => item !== undefined).map(([key, item]) => [key, field(item)]));
}
function parseDoc<T>(doc: any): T {
  return { id: String(doc.name ?? '').split('/').pop() ?? '', ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)])) } as T;
}
function nowIso() { return new Date().toISOString(); }
function unique(items: string[]) { return [...new Set(items.map(x => x.trim()).filter(Boolean))]; }

async function readDocument(collection: string, id: string) {
  try { return await firestore(`/${collection}/${sourceId.parse(id)}`); }
  catch (error) { if (error instanceof FirestoreError && error.status === 404) return null; throw error; }
}

async function listCollection(collection: string, limit = 500) {
  const result = await firestore(`/${collection}?pageSize=${Math.min(limit, 500)}`);
  return result.documents ?? [];
}

function normalizeSource(source: SeoSource): SeoSource {
  return {
    ...source,
    handle: source.handle ?? null,
    topics: unique(source.topics ?? []),
    whyWatch: source.whyWatch ?? '',
    trustNotes: source.trustNotes ?? '',
    notes: source.notes ?? '',
    status: source.status ?? 'active',
    reviewCadenceDays: Number(source.reviewCadenceDays ?? 14),
    revision: Number(source.revision ?? 0),
    origin: source.origin ?? 'firestore'
  };
}

async function allSources() {
  const storedDocs = await listCollection('seoSourceAccounts');
  const stored = storedDocs.map((doc: any) => normalizeSource(parseDoc<SeoSource>(doc)));
  const byId = new Map(BUILTIN_SOURCES.map(item => [item.id, normalizeSource(item)]));
  for (const item of stored) byId.set(item.id, item);
  return [...byId.values()];
}

async function scansForSource(id: string, limit = 10) {
  const docs = await listCollection('seoSourceScans');
  return docs
    .map((doc: any) => parseDoc<SeoSourceScan>(doc))
    .filter(item => item.sourceId === id)
    .sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt)))
    .slice(0, limit);
}

function due(source: SeoSource, latestScan: SeoSourceScan | null, staleAfterDays: number) {
  if (!latestScan) return true;
  const cadence = Math.min(staleAfterDays, source.reviewCadenceDays || staleAfterDays);
  return Date.now() - Date.parse(latestScan.reviewedAt) >= cadence * 86_400_000;
}

export async function seoSourcePoolContext(input: unknown = {}) {
  const args = z.object(seoSourcePoolContextShape).strict().parse(input);
  let sources = await allSources();
  sources = sources.filter(item =>
    (!args.sourceType || item.sourceType === args.sourceType) &&
    (!args.topic || item.topics.some(topic => topic.toLowerCase().includes(args.topic!.toLowerCase()))) &&
    (args.includeArchived || item.status !== 'archived') &&
    (args.includePaused || item.status !== 'paused')
  );

  const items = [];
  for (const source of sources) {
    const scans = await scansForSource(source.id, args.scanLimitPerSource);
    const latestScan = scans[0] ?? null;
    items.push({
      ...source,
      dueForReview: source.status === 'active' && due(source, latestScan, args.staleAfterDays),
      latestScan,
      recentScans: scans
    });
  }

  const recentUsefulFindings = items
    .flatMap(item => (item.recentScans as SeoSourceScan[]).flatMap(scan => scan.findings.map(finding => ({
      sourceId: item.id,
      sourceLabel: item.label,
      scanId: scan.id,
      reviewedAt: scan.reviewedAt,
      outcome: scan.outcome,
      ...finding
    }))))
    .filter(item => ['candidate', 'adopted', 'watch'].includes(item.disposition))
    .sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt)))
    .slice(0, 50);

  return {
    generatedAt: nowIso(),
    mission: 'Maintain a human-curated pool of SEO sources, periodically inspect their recent public output, and preserve useful claims as revisable findings rather than silently turning influencer opinions into policy.',
    rules: [
      'Source reputation is not evidence. Findings must preserve the original URL and distinguish practitioner claims from primary Search documentation.',
      'Do not store full post bodies; store URLs plus concise summaries and relevance notes.',
      'A finding may suggest an evaluator update, but evaluator changes require independent verification appropriate to the claim.',
      'Nothing new is a valid scan outcome. Do not manufacture findings to justify monitoring.'
    ],
    items,
    dueSourceIds: items.filter(item => item.dueForReview).map(item => item.id),
    recentUsefulFindings
  };
}

export async function seoSourceGet(input: unknown) {
  const args = z.object(seoSourceGetShape).strict().parse(input);
  const sources = await allSources();
  const source = sources.find(item => item.id === args.id);
  if (!source) throw new Error('SEO source not found');
  return { source, scans: await scansForSource(source.id, args.scanLimit) };
}

export async function seoSourceSave(input: unknown) {
  const args = z.object(seoSourceSaveShape).strict().parse(input);
  const existingDoc = await readDocument('seoSourceAccounts', args.id);
  const builtin = BUILTIN_SOURCES.find(item => item.id === args.id) ?? null;
  const existing = existingDoc ? normalizeSource(parseDoc<SeoSource>(existingDoc)) : builtin ? normalizeSource(builtin) : null;
  const actualRevision = existingDoc ? existing!.revision : 0;
  if (actualRevision !== args.expectedRevision) throw new Error('Revision conflict: call seo_source_get and reapply the update');
  if (!existing && (!args.sourceType || !args.label || !args.canonicalUrl)) throw new Error('New SEO sources require sourceType, label, and canonicalUrl');

  const t = nowIso();
  const next: SeoSource = normalizeSource({
    id: args.id,
    sourceType: args.sourceType ?? existing!.sourceType,
    label: args.label ?? existing!.label,
    canonicalUrl: args.canonicalUrl ?? existing!.canonicalUrl,
    handle: args.handle !== undefined ? args.handle : existing?.handle ?? null,
    topics: args.topics ?? existing?.topics ?? [],
    whyWatch: args.whyWatch ?? existing?.whyWatch ?? '',
    trustNotes: args.trustNotes ?? existing?.trustNotes ?? '',
    notes: args.notes ?? existing?.notes ?? '',
    status: args.status ?? existing?.status ?? 'active',
    reviewCadenceDays: args.reviewCadenceDays ?? existing?.reviewCadenceDays ?? 14,
    revision: actualRevision + 1,
    createdAt: existingDoc ? existing!.createdAt : builtin?.createdAt ?? t,
    updatedAt: t,
    origin: 'firestore'
  });

  const runId = randomUUID();
  const writes = [
    {
      update: { name: firestoreDocumentName(`seoSourceAccounts/${next.id}`), fields: fields(next) },
      currentDocument: existingDoc ? { updateTime: existingDoc.updateTime } : { exists: false }
    },
    {
      update: { name: firestoreDocumentName(`runs/${runId}`), fields: fields({ id: runId, command: 'seo_source_save', targetId: next.id, actor: 'remote_mcp', createdAt: t, outcome: 'succeeded' }) },
      currentDocument: { exists: false }
    }
  ];
  await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes }) });
  return { source: next, runId };
}

export async function seoSourceScanRecord(input: unknown) {
  const args = z.object(seoSourceScanRecordShape).strict().parse(input);
  const source = (await allSources()).find(item => item.id === args.sourceId);
  if (!source) throw new Error('SEO source not found');
  if (args.periodStart && args.periodEnd && args.periodStart > args.periodEnd) throw new Error('periodStart must be on or before periodEnd');

  const t = args.reviewedAt ?? nowIso();
  const scan: SeoSourceScan = {
    id: `scan-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    sourceId: source.id,
    reviewedAt: t,
    periodStart: args.periodStart ?? null,
    periodEnd: args.periodEnd ?? null,
    outcome: args.outcome,
    summary: args.summary,
    retrievalMethod: args.retrievalMethod,
    limitations: unique(args.limitations),
    findings: args.findings.map(item => ({
      url: item.url,
      publishedAt: item.publishedAt ?? null,
      claimSummary: item.claimSummary,
      relevance: item.relevance,
      disposition: item.disposition,
      confidence: item.confidence,
      verificationNeeded: item.verificationNeeded,
      evaluatorIds: unique(item.evaluatorIds),
      notes: item.notes
    })),
    actor: args.actor,
    createdAt: nowIso()
  };

  const runId = randomUUID();
  await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes: [
    {
      update: { name: firestoreDocumentName(`seoSourceScans/${scan.id}`), fields: fields(scan) },
      currentDocument: { exists: false }
    },
    {
      update: { name: firestoreDocumentName(`runs/${runId}`), fields: fields({ id: runId, command: 'seo_source_scan_record', targetId: source.id, scanId: scan.id, actor: args.actor, createdAt: nowIso(), outcome: 'succeeded' }) },
      currentDocument: { exists: false }
    }
  ] }) });
  return { sourceId: source.id, scan, runId };
}
