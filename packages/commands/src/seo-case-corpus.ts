import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { field, firestore, firestoreDocumentName, FirestoreError, value } from '../../db/src/firestore.js';
import { registeredDomain, youngDomainSerpResearch, youngDomainSerpResearchShape } from './young-domain-serp-research.js';

const domainName = z.string().trim().min(4).max(253);
const caseId = z.string().regex(/^case_[a-f0-9]{24}$/);
const text = z.string().trim().min(1).max(120);

export const seoCaseCollectShape = {
  ...youngDomainSerpResearchShape,
  topic: text,
  includeUnknownAge: z.boolean().default(true),
  maxNewSites: z.number().int().min(1).max(8).default(8)
};
export const seoCaseListShape = {
  limit: z.number().int().min(1).max(100).default(50),
  pageToken: z.string().max(4000).optional()
};
export const seoCaseGetShape = { id: caseId };
export const seoCaseSummaryShape = { limit: z.number().int().min(1).max(100).default(100), pageToken: z.string().max(4000).optional() };

export function seoCaseId(domain: string) {
  const canonical = registeredDomain(domain);
  if (!canonical) throw new Error('Expected a public registrable domain');
  return 'case_' + createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}
function encodedFields(data: object) {
  return Object.fromEntries(Object.entries(data).filter(([, item]) => item !== undefined).map(([key, item]) => [key, field(item)]));
}
function decodeDoc(doc: any) {
  return { ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, v]) => [key, value(v)])), id: String(doc.name ?? '').split('/').pop() } as any;
}
function normalizeObservation(input: any) {
  return {
    query: String(input.query ?? '').slice(0, 200),
    position: typeof input.position === 'number' ? input.position : null,
    title: String(input.title ?? '').slice(0, 500),
    url: String(input.url ?? '').slice(0, 2000),
    provider: String(input.provider ?? ''),
    upstreamProvider: input.upstreamProvider ?? null,
    observedAt: String(input.observedAt ?? '')
  };
}

/**
 * Store only a first discovery per domain. This is a cross-topic case library,
 * not a monitoring or rank-history model. Repeated observations can be
 * investigated with the existing read-only young_domain_serp_research tool.
 */
export function materializeCase(input: any, topic: string, pages: any[], collectedAt: string) {
  const best = [...input.appearances].sort((a: any, b: any) => (a.position ?? 999) - (b.position ?? 999));
  const reviews = pages.filter(page => page.domain === input.domain && page.status === 'read').slice(0, 2);
  const observations = best.slice(0, 12).map(normalizeObservation);
  return {
    id: seoCaseId(input.domain),
    domain: input.domain,
    topics: [topic],
    registrationStatus: input.registrationStatus,
    registrationDate: input.registrationDate ?? null,
    domainAgeDaysAtDiscovery: input.domainAgeDays ?? null,
    rdapUrl: input.rdapUrl ?? null,
    firstObservedAt: collectedAt,
    createdAt: collectedAt,
    bestObservedPosition: input.bestPosition ?? null,
    observedQueryCount: input.queryCount ?? 0,
    observations,
    pageEvidence: reviews.map(page => ({
      url: String(page.url).slice(0, 2000),
      finalUrl: String(page.finalUrl ?? page.url).slice(0, 2000),
      title: String(page.title ?? '').slice(0, 500),
      excerpt: String(page.text ?? '').slice(0, 1000),
      truncated: Boolean(page.truncated),
      fetchedAt: String(page.fetchedAt ?? '')
    })),
    interpretationStatus: 'unreviewed',
    siteIdeaStatus: 'reference_only',
    limitations: [
      'Domain registration does not establish site launch, original ownership, content novelty, backlink history or ranking cause.',
      'Observed search position is a single provider snapshot, not measured Google traffic or stable ranking.'
    ],
    revision: 1
  };
}

type CorpusDependencies = {
  discover: typeof youngDomainSerpResearch;
  request: typeof firestore;
  clock: () => string;
  id: () => string;
};
const live: CorpusDependencies = { discover: youngDomainSerpResearch, request: firestore, clock: () => new Date().toISOString(), id: randomUUID };

async function readCase(request: typeof firestore, id: string) {
  try { return decodeDoc(await request('/seoCaseSites/' + caseId.parse(id))); }
  catch (error) { if (error instanceof FirestoreError && error.status === 404) return null; throw error; }
}
async function commitCases(request: typeof firestore, cases: any[], actorId: string, now: string) {
  const writes = cases.map(item => ({
    update: { name: firestoreDocumentName('seoCaseSites/' + item.id), fields: encodedFields(item) },
    currentDocument: { exists: false }
  }));
  writes.push({
    update: { name: firestoreDocumentName('runs/' + actorId), fields: encodedFields({
      id: actorId, command: 'seo_case_collect', targetId: 'seoCaseSites', actor: 'remote_mcp',
      createdAt: now, count: cases.length, outcome: 'succeeded'
    }) },
    currentDocument: { exists: false }
  });
  await request(':commit', { method: 'POST', body: JSON.stringify({ writes }) });
}

export async function seoCaseCollect(input: unknown, deps: CorpusDependencies = live) {
  const args = z.object(seoCaseCollectShape).strict().parse(input);
  const { topic, includeUnknownAge, maxNewSites, ...discoveryArgs } = args;
  const discovery = await deps.discover(discoveryArgs);
  // Preserve the evidence of failed searches, but never turn that into a successful harvest.
  const candidates = [
    ...discovery.recentRegistrationCandidates,
    ...(includeUnknownAge ? discovery.unknownRegistrationCandidates : [])
  ].slice(0, maxNewSites);
  const now = deps.clock();
  const prepared = candidates.map(item => materializeCase(item, topic, discovery.pageReviews, now));
  const existing: string[] = [];
  const toCreate: any[] = [];
  for (const item of prepared) {
    if (await readCase(deps.request, item.id)) existing.push(item.domain);
    else toCreate.push(item);
  }

  let saved = toCreate;
  let collisions = 0;
  let runId: string | null = null;
  if (saved.length) {
    // Optimistic create-only write. If another collector won the race, recheck
    // and save only still-missing domains (no overwriting older evidence).
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!saved.length) break;
      try {
        const id = deps.id();
        await commitCases(deps.request, saved, id, now);
        runId = id;
        break;
      } catch (error) {
        if (!(error instanceof FirestoreError) || ![409, 412].includes(error.status) || attempt === 1) throw error;
        const remaining = [];
        for (const item of saved) {
          if (await readCase(deps.request, item.id)) { existing.push(item.domain); collisions++; }
          else remaining.push(item);
        }
        saved = remaining;
      }
    }
  }
  return {
    collectedAt: now, topic,
    newlySaved: runId ? saved.length : 0,
    alreadyInCorpus: [...new Set(existing)].length,
    skippedForAgeOrBudget: discovery.olderRegistrationCount + discovery.uncheckedDomainCount,
    candidateCount: candidates.length,
    newCases: runId ? saved.map(item => ({ id: item.id, domain: item.domain, registrationStatus: item.registrationStatus, bestObservedPosition: item.bestObservedPosition, topics: item.topics })) : [],
    runId,
    collisions,
    discoveryCoverage: discovery.coverage,
    errors: discovery.errors,
    note: 'Corpus-first: once per domain by default. No routine rank refresh or automatic SEO/task/site idea approval.'
  };
}

export async function seoCaseGet(input: unknown, request: typeof firestore = firestore) {
  const args = z.object(seoCaseGetShape).strict().parse(input);
  const item = await readCase(request, args.id);
  if (!item) throw new Error('SEO case not found');
  return item;
}

export async function seoCaseList(input: unknown = {}, request: typeof firestore = firestore) {
  const args = z.object(seoCaseListShape).strict().parse(input);
  const params = new URLSearchParams({ pageSize: String(args.limit), orderBy: 'createdAt desc' });
  if (args.pageToken) params.set('pageToken', args.pageToken);
  const result = await request('/seoCaseSites?' + params);
  return { items: (result.documents ?? []).map(decodeDoc), nextPageToken: result.nextPageToken ?? null,
    scope: 'stored domain-level first discoveries; not rank history or a complete web census' };
}

/** Sample-level descriptive aggregates for exploration, never inferred SEO causes. */
export async function seoCaseSummary(input: unknown = {}, request: typeof firestore = firestore) {
  const args = z.object(seoCaseSummaryShape).strict().parse(input);
  const listing = await seoCaseList({ limit: args.limit, pageToken: args.pageToken }, request);
  const topics = new Map<string, { domainCount: number; examples: string[] }>();
  const searchForms = new Map<string, number>();
  let recentRegistration = 0;
  let ageUnknown = 0;
  for (const item of listing.items) {
    if (item.registrationStatus === 'recent_registration') recentRegistration++;
    if (item.registrationStatus === 'unknown') ageUnknown++;
    for (const topic of item.topics ?? []) {
      const current = topics.get(topic) ?? { domainCount: 0, examples: [] };
      current.domainCount++;
      if (current.examples.length < 5) current.examples.push(item.domain);
      topics.set(topic, current);
    }
    for (const obs of item.observations ?? []) {
      const q = String(obs.query ?? '').toLowerCase();
      const form = /\bvs\b|比較|どっち|違い|difference|versus/.test(q) ? 'comparison'
        : /how to|方法|やり方|使い方|設定/.test(q) ? 'how_to'
        : /いつ|when|date|期限|いつまで|終了/.test(q) ? 'timing'
        : 'other_or_unknown';
      searchForms.set(form, (searchForms.get(form) ?? 0) + 1);
    }
  }
  return {
    analyzedCases: listing.items.length, scope: 'one fetched page only',
    nextPageToken: listing.nextPageToken,
    recentRegistration, ageUnknown,
    topicCoverage: [...topics].map(([topic, value]) => ({ topic, ...value })).sort((a, b) => b.domainCount - a.domainCount),
    observedQueryForms: [...searchForms].map(([form, count]) => ({ form, count })),
    caveat: 'Keyword-form buckets are lexical, overlap across observations and do not establish ranking factors. Themes are collection tags, not verified site categories.'
  };
}
