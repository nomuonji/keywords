import { z } from 'zod';
import { distributionCaseDiscovery } from './distribution-case-discovery.js';
import { marketProductDiscovery } from './market-product-discovery.js';
import { searchGapResearch } from './search-gap-research.js';
import { marketSignalScan } from '../../research/src/market-sensors.js';

/**
 * Read-only evidence adapters. The agent chooses a useful next action from the
 * objective, existing evidence, remaining uncertainty and cost. Neither action
 * requires the other, and this tool never approves a market opportunity.
 */
const candidateShape = z.object({
  name: z.string().trim().min(3).max(140),
  audience: z.string().trim().min(5).max(300),
  userNeed: z.string().trim().min(8).max(450),
  databaseUnit: z.string().trim().min(3).max(160),
  interaction: z.string().trim().min(5).max(300),
  query: z.string().trim().min(2).max(200),
  evidenceUrls: z.array(z.string().url().max(2000).refine(v => /^https?:\/\//i.test(v))).max(2).default([])
}).strict();

export const marketDiscoveryRunShape = {
  phase: z.enum(['observe', 'validate']).default('observe'),
  objective: z.string().trim().min(3).max(500).optional(),
  // Kept for existing callers; this is a presentation hint, not a research-depth mode.
  mode: z.enum(['db_site', 'general', 'commerce']).default('general'),
  sources: z.array(z.enum(['curated_links', 'open_signals', 'commerce_rankings'])).min(1).max(3).optional(),
  rotation: z.number().int().min(0).max(50).default(0),
  maxObservations: z.number().int().min(1).max(60).default(32),
  withDemand: z.boolean().default(false),
  candidates: z.array(candidateShape).max(3).default([])
};
const inputShape = z.object(marketDiscoveryRunShape).strict();
type Input = z.infer<typeof inputShape>;
type Candidate = z.infer<typeof candidateShape>;
type SourceId = 'curated_links' | 'open_signals' | 'commerce_rankings';
type SourceObservation = {
  family: string;
  source: string;
  sourcePlatform: string;
  sourceUrl: string | null;
  label: string;
  url: string;
  observedAt: string | null;
  fact: string;
  measures: Record<string, unknown>;
};

const domain = (url: string) => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
};
const errorLabel = (e: unknown) =>
  e instanceof Error ? e.message.replace(/https?:\/\/\S+/g, '[url]').slice(0, 160) : 'source_unavailable';

/** A page read is evidence to examine, never an automatic finding of an answer gap. */
export function assessDiscoveryGate(input: {
  competitorPages: { url: string; status: string }[];
  evidencePages: { url: string; status: string }[];
  resultCount: number;
  demandAvailable: boolean;
}) {
  const competitors = input.competitorPages.filter(p => p.status === 'read');
  const evidence = input.evidencePages.filter(p => p.status === 'read');
  const competitorHosts = new Set(competitors.map(p => domain(p.url)).filter(Boolean));
  const evidenceHosts = new Set(evidence.map(p => domain(p.url)).filter(Boolean));
  const distinctEvidenceHostObserved = [...evidenceHosts].some(x => !competitorHosts.has(x));
  const missing = [
    ...(input.resultCount === 0 ? ['no_search_results_observed'] : []),
    ...(competitors.length === 0 ? ['no_competitor_body_read'] : []),
    ...(input.evidencePages.length > 0 && evidence.length === 0 ? ['candidate_source_pages_unread'] : [])
  ];
  return {
    status: missing.length ? 'insufficient_evidence' as const : 'evidence_review_required' as const,
    checks: {
      observedSearchResults: input.resultCount,
      competitorBodiesRead: competitors.length,
      candidateSourcesRead: evidence.length,
      distinctEvidenceHostObserved,
      demandObserved: input.demandAvailable
    },
    missing,
    independence: 'unverified' as const,
    canClaimVerifiedOpportunity: false,
    nextChecks: [
      'Compare actual page answers against the specific user need; a read or a distinct host is not independent corroboration.',
      'Check source rights, updateability, user behavior, traffic path and revenue only when the requested decision needs them.',
      'Seek a counterexample to the most consequential assumption before a strong recommendation.'
    ]
  };
}

type Dependencies = {
  distribution?: typeof distributionCaseDiscovery;
  signals?: typeof marketSignalScan;
  products?: typeof marketProductDiscovery;
  gap?: typeof searchGapResearch;
  demand?: (keywords: string[]) => Promise<unknown>;
  clock?: () => number;
};

export async function marketDiscoveryRun(input: unknown, dependencies: Dependencies = {}) {
  const args: Input = inputShape.parse(input);
  const fetchedAt = new Date(dependencies.clock?.() ?? Date.now()).toISOString();
  if (args.phase === 'observe') {
    if (args.candidates.length) throw Error('Observe accepts no candidates. Use validate directly for a selected or previously known candidate.');
    if (args.withDemand) throw Error('withDemand applies only to validate.');
    const selected: SourceId[] = args.sources ?? (args.mode === 'commerce'
      ? ['curated_links', 'open_signals', 'commerce_rankings']
      : ['curated_links', 'open_signals']);
    const tasks = selected.map(id => ({
      id,
      call: id === 'curated_links'
        ? (dependencies.distribution ?? distributionCaseDiscovery)({ maxCases: Math.min(24, args.maxObservations), rotation: args.rotation, includeGlobalTech: true })
        : id === 'open_signals'
          ? (dependencies.signals ?? marketSignalScan)({ sources: ['google_trends', 'hacker_news'], geo: 'JP', limit: Math.min(20, args.maxObservations), hackerNewsFeed: 'new' })
          : (dependencies.products ?? marketProductDiscovery)({ mode: 'discover', maxCategories: 4, productsPerCategory: 2, rotation: args.rotation })
    }));
    const finished = await Promise.allSettled(tasks.map(task => task.call));
    const failures: { source: SourceId; detail: string }[] = [];
    const raw: Record<string, unknown> = {};
    finished.forEach((entry, i) => {
      if (entry.status === 'fulfilled') raw[tasks[i].id] = entry.value;
      else failures.push({ source: tasks[i].id, detail: errorLabel(entry.reason) });
    });
    const observed: SourceObservation[] = [];
    const used = new Set<string>();
    const add = (item: SourceObservation, key: string) => {
      if (!item.url || used.has(key)) return;
      used.add(key);
      observed.push(item);
    };
    const dist = raw.curated_links as Awaited<ReturnType<typeof distributionCaseDiscovery>> | undefined;
    for (const item of dist?.cases ?? []) add({
      family: item.sourcePlatform === 'hacker_news' ? 'developer_community' : 'curated_public_discussion',
      source: item.sourceId, sourcePlatform: item.sourcePlatform,
      sourceUrl: item.sourcePostUrl ?? item.discoverySourceUrl,
      label: item.title, url: item.destinationUrl, observedAt: item.publishedAt,
      fact: 'A dated public curation entry linked to this destination; visits and sales are unknown.',
      measures: { engagement: item.engagement, providerTags: item.observedTags }
    }, item.destinationUrl);
    const sig = raw.open_signals as Awaited<ReturnType<typeof marketSignalScan>> | undefined;
    for (const group of sig?.results ?? []) for (const item of group.observations) {
      if (!item.url) continue;
      add({
        family: item.source === 'google_trends' ? 'search_attention' : 'developer_community',
        source: item.source, sourcePlatform: item.source, sourceUrl: group.url,
        label: item.label, url: item.url, observedAt: item.observedAt,
        fact: 'A public attention signal or community post was observed; purchases and site viability are unknown.',
        measures: item.metrics
      }, item.source + ':' + item.label + ':' + item.url);
    }
    const prod = raw.commerce_rankings as Awaited<ReturnType<typeof marketProductDiscovery>> | undefined;
    if (prod && !prod.ok) failures.push({ source: 'commerce_rankings', detail: prod.status });
    for (const category of prod?.ok ? prod.categories : []) for (const item of category.items ?? []) {
      if (!item.sellerUrl) continue;
      add({
        family: 'ranked_commerce', source: 'rakuten_rankings', sourcePlatform: 'rakuten',
        sourceUrl: item.rankSourceUrl ?? null,
        label: item.name, url: item.sellerUrl, observedAt: category.observationDate,
        fact: 'A ranked item was observed; disclosed purchases are unknown.',
        measures: { rank: item.rank, genre: category.genreName }
      }, item.sellerUrl);
    }
    const returned = observed.slice(0, args.maxObservations);
    const platforms = [...new Set(returned.map(v => v.sourcePlatform))];
    return {
      phase: 'observe' as const, objective: args.objective ?? null, mode: args.mode, fetchedAt,
      coverage: {
        requestedSources: selected, observedPlatforms: platforms,
        observedRecords: returned.length, totalBeforeLimit: observed.length,
        unavailableSources: failures,
        sourceWarnings: sig?.warnings ?? [],
        interpretation: 'Source/platform breadth describes this sample. It does not certify sufficient research or independent claims.'
      },
      observations: returned,
      discoveredProviderTags: dist?.observedNiches?.slice(0, 25) ?? [],
      nextAction: 'Use observed records for explicitly labeled hypotheses, or stop if the objective is met. Investigate only uncertainty that could change the requested decision; validate can also be called directly.',
      writes: 0
    };
  }

  if (args.sources?.length) throw Error('sources applies only to observe.');
  if (!args.candidates.length) throw Error('validate requires 1-3 explicit candidates; prior observe is optional.');
  const gap = dependencies.gap ?? searchGapResearch;
  const results = await Promise.all(args.candidates.map(async (candidate: Candidate) => {
    const question = 'For "' + candidate.name + '", what real user problem does existing content already solve? What structured source data and independent unmet need are visible? Proposed need: ' + candidate.userNeed.slice(0, 250);
    const [search, demand] = await Promise.allSettled([
      gap({ query: candidate.query, question, maxPages: 3, maxCharsPerPage: 4500,
        evidenceUrls: candidate.evidenceUrls, num: 6, country: 'JP', language: 'ja' }),
      args.withDemand && dependencies.demand ? dependencies.demand([candidate.query]) : Promise.resolve(null)
    ]);
    const warnings: string[] = [];
    if (search.status === 'rejected') warnings.push('competitive_research_unavailable:' + errorLabel(search.reason));
    if (demand.status === 'rejected') warnings.push('demand_provider_unavailable:' + errorLabel(demand.reason));
    if (args.withDemand && !dependencies.demand) warnings.push('demand_provider_not_connected');
    const research = search.status === 'fulfilled' ? search.value : null;
    const pages = research?.pages ?? [];
    const sources = research?.observations ?? [];
    const gate = assessDiscoveryGate({
      competitorPages: pages, evidencePages: sources,
      resultCount: research?.serp?.results?.length ?? 0,
      demandAvailable: demand.status === 'fulfilled' && demand.value !== null
    });
    return {
      candidate: { name: candidate.name, audience: candidate.audience, userNeed: candidate.userNeed,
        databaseUnit: candidate.databaseUnit, interaction: candidate.interaction, query: candidate.query },
      search: {
        provider: research?.serp?.provider ?? null,
        results: (research?.serp?.results ?? []).slice(0, 6).map(v => ({ title: v.title, url: v.link, snippet: v.snippet })),
        competitorPages: pages.map(v => ({ url: v.url, status: v.status, excerpt: v.status === 'read' ? String(v.text ?? '').slice(0, 2500) : null })),
        candidateSourcePages: sources.map(v => ({ url: v.url, status: v.status, excerpt: v.status === 'read' ? String(v.text ?? '').slice(0, 2500) : null }))
      },
      searchDemand: demand.status === 'fulfilled' ? demand.value : null,
      gate, warnings,
      verdict: 'evidence_for_agent_assessment_not_an_approved_market'
    };
  }));
  return {
    phase: 'validate' as const, objective: args.objective ?? null, mode: args.mode, fetchedAt, results,
    interpretation: 'This targeted read does not establish search opportunity, source rights, user demand, distribution or revenue. The agent must assess evidence and contrary facts against the requested decision.',
    writes: 0
  };
}
