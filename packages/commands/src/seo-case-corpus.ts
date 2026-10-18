import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { field, firestore, firestoreDocumentName, FirestoreError, value } from '../../db/src/firestore.js';
import { registeredDomain, youngDomainSerpResearch, youngDomainSerpResearchShape } from './young-domain-serp-research.js';

const caseId = z.string().regex(/^case_[a-f0-9]{24}$/);
const text = z.string().trim().min(1).max(120);

export const seoCaseCollectShape = {
  ...youngDomainSerpResearchShape,
  // An evidence-led case library must not silently mix Brave with Google-proxy positions.
  provider: z.literal('api').default('api'),
  maxPageReads: z.number().int().min(1).max(4).default(4),
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

/** A small, explicit hard gate on verifiable facts; not an AI quality score. */
export const SEO_CASE_GATE_VERSION = '2026-10-18-v1';
export const SEO_CASE_MAX_AGE_DAYS = 365;
export const SEO_CASE_MAX_SERP_POSITION = 10;
export const SEO_CASE_MIN_PAGE_CHARS = 160;
const DAY_MS = 86_400_000;

function suitableOrganicHit(hit: any, domain: string) {
  const query = String(hit.query ?? '').normalize('NFKC').toLowerCase().trim();
  if (!query || /(?:^|\s)(?:site:|inurl:|intitle:)/.test(query) || /https?:\/\/|www\./.test(query)) return false;
  // Obvious navigational terms are not evidence of ranking for a topic query.
  const condensed = query.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]/g, '');
  const stem = domain.split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const fullDomain = domain.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (condensed.includes(fullDomain) || (stem.length >= 5 && condensed.includes(stem))) return false;
  if (hit.provider !== 'api' || !['reserp', 'brightdata'].includes(hit.upstreamProvider)) return false;
  if (!Number.isInteger(hit.position) || hit.position < 1 || hit.position > SEO_CASE_MAX_SERP_POSITION) return false;
  try {
    const url = new URL(hit.url);
    if (url.protocol !== 'https:' || registeredDomain(url.hostname) !== domain) return false;
  } catch { return false; }
  return true;
}
export function evaluateSeoCaseGate(candidate: any, pages: any[], now: string) {
  const reasons: string[] = [];
  const registrationMs = Date.parse(String(candidate.registrationDate ?? ''));
  const nowMs = Date.parse(now);
  const registrationAgeDays = Number.isFinite(registrationMs) && Number.isFinite(nowMs)
    ? Math.floor((nowMs - registrationMs) / DAY_MS)
    : null;
  if (candidate.registrationStatus !== 'recent_registration'
    || registrationAgeDays === null || registrationAgeDays < 0) {
    reasons.push('registration_unverified');
  } else if (registrationAgeDays > SEO_CASE_MAX_AGE_DAYS) {
    reasons.push('registration_older_than_365_days');
  }
  // Do not call self-reported GSC metrics or proxy search hints a verified rank.
  const hits = (Array.isArray(candidate.appearances) ? candidate.appearances : [])
    .filter((hit: any) => suitableOrganicHit(hit, String(candidate.domain ?? '')))
    .sort((a: any, b: any) => a.position - b.position);
  if (!hits.length) reasons.push('no_nonbranded_google_proxy_top10');
  const matchingPage = hits.map((hit: any) => pages.find((page: any) => {
    if (page.domain !== candidate.domain || page.status !== 'read' || page.url !== hit.url) return false;
    try { return registeredDomain(new URL(page.finalUrl ?? page.url).hostname) === candidate.domain; }
    catch { return false; }
  })).find(Boolean);
  const pageChars = String(matchingPage?.text ?? '').trim().length;
  if (!matchingPage || pageChars < SEO_CASE_MIN_PAGE_CHARS
      || /\b(?:access denied|captcha|please enable javascript|sign in to continue)\b/i.test(String(matchingPage.text).slice(0, 250))) {
    reasons.push('page_body_unverified_or_thin');
  }
  const qualifyingQueryCount = new Set(hits.map((hit: any) => hit.query.normalize('NFKC').toLowerCase().trim())).size;
  const bestPosition = hits[0]?.position ?? null;
  const passed = reasons.length === 0;
  return {
    passed,
    policyVersion: SEO_CASE_GATE_VERSION,
    reasons,
    evidenceStrength: passed && (bestPosition <= 5 || qualifyingQueryCount >= 2) ? 'strong_observation' : passed ? 'single_top10_observation' : 'insufficient',
    registrationAgeDays,
    bestQualifiedPosition: bestPosition,
    qualifyingQueryCount,
    pageChars: pageChars,
    qualifyingUrl: matchingPage?.url ?? null,
    // Additional relevance, editorial value, rank persistence and theme viability
    // are human/agent research judgments, not implicit effects of passing this gate.
    interpretationRequired: true
  };
}

/**
 * Store only a first discovery per domain. This is a cross-topic case library,
 * not a monitoring or rank-history model. Repeated observations can be
 * investigated with the existing read-only young_domain_serp_research tool.
 */
export function materializeCase(input: any, topic: string, pages: any[], collectedAt: string, gate = evaluateSeoCaseGate(input, pages, collectedAt)) {
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
    qualityGate: gate,
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
  ];
  const now = deps.clock();
  const gateEvaluations = candidates.map(item => ({
    candidate: item, gate: evaluateSeoCaseGate(item, discovery.pageReviews, now)
  }));
  // Evaluate every checked candidate before limiting saves: failing candidates
  // must not consume the maxNewSites allowance or enter the clean corpus.
  const accepted = gateEvaluations.filter(item => item.gate.passed).slice(0, maxNewSites);
  const prepared = accepted.map(({ candidate, gate }) => materializeCase(candidate, topic, discovery.pageReviews, now, gate));
  const gateRejectedReasons = Object.entries(gateEvaluations
    .filter(item => !item.gate.passed)
    .flatMap(item => item.gate.reasons)
    .reduce<Record<string, number>>((counts, reason) => ({ ...counts, [reason]: (counts[reason] ?? 0) + 1 }), {}))
    .map(([reason, count]) => ({ reason, count }));
  const gateRejectedExamples = gateEvaluations.filter(item => !item.gate.passed).slice(0, 8)
    .map(item => ({ domain: item.candidate.domain, reasons: item.gate.reasons }));
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
    gatePassedCount: gateEvaluations.filter(item => item.gate.passed).length,
    gateRejectedCount: gateEvaluations.filter(item => !item.gate.passed).length,
    gateRejectedReasons,
    gateRejectedExamples,
    notSavedDueToBatchLimit: Math.max(0, gateEvaluations.filter(item => item.gate.passed).length - accepted.length),
    qualityGateVersion: SEO_CASE_GATE_VERSION,
    newCases: runId ? saved.map(item => ({ id: item.id, domain: item.domain, registrationStatus: item.registrationStatus, bestObservedPosition: item.bestObservedPosition, topics: item.topics })) : [],
    runId,
    collisions,
    discoveryCoverage: discovery.coverage,
    errors: discovery.errors,
    note: 'Evidence gate is mandatory: verified registration within 365 days, nonbranded Google-proxy top10 and readable matching page >=160 chars. Unknown-age/Brave/thin pages are rejected, not silently admitted. No automatic success or idea verdict.'
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
