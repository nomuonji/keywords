import { z } from 'zod';
import { distributionCaseDiscovery } from './distribution-case-discovery.js';
import { marketProductDiscovery } from './market-product-discovery.js';
import { searchGapResearch } from './search-gap-research.js';
import { marketSignalScan } from '../../research/src/market-sensors.js';

/**
 * This is a read-only two-stage research runner, NOT an LLM idea generator.
 * observe -> agent proposes falsifiable candidates -> validate.
 * No automatic "pilot_ready": a human/agent must compare the page bodies
 * and verify data rights, user need, distribution and delivery feasibility.
 */
const candidateShape = z.object({
  name: z.string().trim().min(3).max(140),
  audience: z.string().trim().min(5).max(300),
  userNeed: z.string().trim().min(8).max(450),
  databaseUnit: z.string().trim().min(3).max(160),
  interaction: z.string().trim().min(5).max(300),
  query: z.string().trim().min(2).max(200),
  // Candidate-provided leads are checked by fetching the actual pages.
  // Merely submitting a URL does not count as corroborated evidence.
  evidenceUrls: z.array(z.string().url().max(2000).refine(v => /^https?:\\/\\//i.test(v))).max(2).default([])
}).strict();

export const marketDiscoveryRunShape = {
  phase: z.enum(['observe','validate']).default('observe'),
  mode: z.enum(['db_site','general','commerce']).default('general'),
  rotation: z.number().int().min(0).max(50).default(0),
  maxObservations: z.number().int().min(8).max(60).default(32),
  candidates: z.array(candidateShape).max(3).default([])
};
const inputShape = z.object(marketDiscoveryRunShape).strict();
type Input = z.infer<typeof inputShape>;
type Candidate = z.infer<typeof candidateShape>;

type SourceObservation = {
  family: string;
  source: string;
  label: string;
  url: string;
  observedAt: string | null;
  fact: string;
  measures: Record<string, unknown>;
};

const domain = (url: string) => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\\./,''); } catch { return ''; }
};
const errorLabel = (e: unknown) =>
  e instanceof Error ? e.message.replace(/https?:\\/\\/\\S+/g,'[url]').slice(0,160) : 'source_unavailable';

export function assessDiscoveryGate(input: {
  competitorPages: { url: string; status: string }[];
  evidencePages: { url: string; status: string }[];
  resultCount: number;
  demandAvailable: boolean;
}) {
  const competitors = input.competitorPages.filter(p => p.status === 'read');
  const evidence = input.evidencePages.filter(p => p.status === 'read');
  const competitorDomains = new Set(competitors.map(p => domain(p.url)).filter(Boolean));
  const evidenceDomains = new Set(evidence.map(p => domain(p.url)).filter(Boolean));
  const independentlySourced = [...evidenceDomains].some(x => !competitorDomains.has(x));
  const missing = [
    ...(input.resultCount < 2 ? ['search_results_insufficient'] : []),
    ...(competitors.length < 2 ? ['fewer_than_two_competitor_bodies_read'] : []),
    ...(evidence.length < 1 ? ['no_candidate_source_page_read'] : []),
    ...(!independentlySourced ? ['no_independent_evidence_domain'] : [])
  ];
  return {
    status: missing.length ? 'insufficient_evidence' as const : 'editorial_review_required' as const,
    checks: {
      observedSearchResults: input.resultCount,
      competitorBodiesRead: competitors.length,
      candidateSourcesRead: evidence.length,
      independentEvidenceDomains: independentlySourced,
      demandObserved: input.demandAvailable
    },
    missing,
    // Automated signals alone cannot prove an answer gap, demand, or viability.
    canClaimVerifiedOpportunity: false,
    nextHumanChecks: [
      'Quote and compare actual competitor page answers, not just snippets or domain names.',
      'Confirm the DB source permits reuse, systematic updates, and attributable claims.',
      'Challenge the core user need with independent user behavior or a real task.',
      'Check a sustainable traffic path and monetization, rather than inferring it from volume.',
      'Only promote via the existing qualitative theme research ledger after an independent challenge.'
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
  const observe = dependencies.distribution ?? distributionCaseDiscovery;
  const scan = dependencies.signals ?? marketSignalScan;
  if (args.phase === 'observe') {
    if (args.candidates.length) throw Error('Candidates are only accepted in phase=validate. Observe first without model-generated seeds.');
    const tasks: { id: string; call: Promise<unknown> }[] = [
      { id:'curated_links',call:observe({maxCases:Math.min(24,args.maxObservations),rotation:args.rotation,includeGlobalTech:true}) },
      { id:'open_signals',call:scan({sources:['google_trends','hacker_news'],geo:'JP',limit:Math.min(20,args.maxObservations),hackerNewsFeed:'new'}) }
    ];
    if (args.mode === 'commerce') {
      tasks.push({id:'independent_rankings',call:(dependencies.products ?? marketProductDiscovery)({
        mode:'discover',maxCategories:4,productsPerCategory:2,rotation:args.rotation
      })});
    }
    const finished = await Promise.allSettled(tasks.map(task => task.call));
    const failures: { source: string; detail: string }[] = [];
    const raw: Record<string, unknown> = {};
    finished.forEach((entry,i) => {
      if (entry.status === 'fulfilled') raw[tasks[i].id] = entry.value;
      else failures.push({source:tasks[i].id,detail:errorLabel(entry.reason)});
    });
    const observed: SourceObservation[] = [];
    const used = new Set<string>();
    const add = (item: SourceObservation) => {
      if (!item.url || used.has(item.url)) return;
      used.add(item.url);
      observed.push(item);
    };
    const dist = raw.curated_links as Awaited<ReturnType<typeof distributionCaseDiscovery>> | undefined;
    for (const item of dist?.cases ?? []) add({
      family:item.sourcePlatform === 'hacker_news' ? 'developer_community' : 'curated_public_discussion',
      source:item.sourceId,label:item.title,url:item.destinationUrl,
      observedAt:item.publishedAt,
      fact:'Observed destination linked from a dated public curation entry; not visits or sales.',
      measures:{engagement:item.engagement,providerTags:item.observedTags}
    });
    const sig = raw.open_signals as Awaited<ReturnType<typeof marketSignalScan>> | undefined;
    for (const group of sig?.results ?? []) for (const item of group.observations) {
      if (!item.url) continue;
      add({family:item.source === 'google_trends' ? 'search_attention' : 'developer_community',
        source:item.source,label:item.label,url:item.url,observedAt:item.observedAt,
        fact:'Observed public search attention or community post; not purchases or a database-site opportunity.',
        measures:item.metrics});
    }
    const prod = raw.independent_rankings as Awaited<ReturnType<typeof marketProductDiscovery>> | undefined;
    for (const category of prod?.categories ?? []) {
      for (const item of category.items ?? []) {
        if (!item.sellerUrl) continue;
        add({family:'ranked_commerce',source:'rakuten_rankings',
          label:item.name,url:item.sellerUrl,observedAt:category.observationDate,
          fact:'Ranked item observed, not disclosed purchases.',measures:{rank:item.rank,genre:category.genreName}});
      }
    }
    const returned = observed.slice(0,args.maxObservations);
    const families = [...new Set(returned.map(v=>v.family))];
    return {
      phase:'observe',mode:args.mode,fetchedAt,
      coverage:{familyCount:families.length,families,distinctSourceUrls:returned.length,
        sufficientForInitialHypotheses:families.length >= 2 && returned.length >= 8,
        unavailableSources:failures,
        limitations:['Two public sensor families are not a representative sample of all markets.',
          'The same link in multiple feeds is counted once; feed categories are not independent platforms.',
          'Additional public datasets, community records, official sources and first-party evidence must be researched by the agent.']},
      observations:returned,
      discoveredProviderTags:dist?.observedNiches?.slice(0,25) ?? [],
      nextAction:'Generate diverse, explicitly unverified hypotheses from observed records. Then call phase=validate for up to 3 candidates at a time. Never equate a number of ideas with a number of validated markets.',
      writes:0
    };
  }

  if (!args.candidates.length) throw Error('phase=validate requires 1-3 explicit candidates with observable URLs.');
  const gap = dependencies.gap ?? searchGapResearch;
  const results = await Promise.all(args.candidates.map(async (candidate: Candidate) => {
    const question = 'For the proposed DB "' + candidate.name + '", what real user problem does existing content already solve? What concrete structured source data and independent unmet need are visible? The candidate proposes: ' + candidate.userNeed.slice(0,250);
    const [search, demand] = await Promise.allSettled([
      gap({query:candidate.query,question,maxPages:3,maxCharsPerPage:4500,
        evidenceUrls:candidate.evidenceUrls,num:6,country:'JP',language:'ja'}),
      dependencies.demand ? dependencies.demand([candidate.query]) : Promise.resolve(null)
    ]);
    const warnings: string[] = [];
    if (search.status === 'rejected') warnings.push('competitive_research_unavailable:'+errorLabel(search.reason));
    if (demand.status === 'rejected') warnings.push('demand_provider_unavailable:'+errorLabel(demand.reason));
    const research = search.status === 'fulfilled' ? search.value : null;
    const pages = research?.pages ?? [];
    const sources = research?.observations ?? [];
    const gate = assessDiscoveryGate({
      competitorPages:pages, evidencePages:sources,
      resultCount:research?.serp?.results?.length ?? 0,
      demandAvailable:demand.status === 'fulfilled' && demand.value !== null
    });
    return {
      candidate:{name:candidate.name,audience:candidate.audience,userNeed:candidate.userNeed,
        databaseUnit:candidate.databaseUnit,interaction:candidate.interaction,query:candidate.query},
      search:{provider:research?.serp?.provider ?? null,
        results:(research?.serp?.results ?? []).slice(0,6).map(v=>({title:v.title,url:v.link,snippet:v.snippet})),
        competitorPages:pages.map(v=>({url:v.url,status:v.status,
          excerpt:v.status === 'read' ? String(v.text ?? '').slice(0,2500) : null})),
        candidateSourcePages:sources.map(v=>({url:v.url,status:v.status,
          excerpt:v.status === 'read' ? String(v.text ?? '').slice(0,2500) : null}))},
      searchDemand:demand.status === 'fulfilled' ? demand.value : null,
      gate,warnings,
      verdict:'review_required_not_an_approved_or_verified_market'
    };
  }));
  return {phase:'validate',mode:args.mode,fetchedAt,results,
    prohibitedInferences:['Search volume is not DB-site demand.',
      'A source URL alone is not evidence of usable data or reuse rights.',
      'No first-party sales, conversions, user interviews, or verified traffic are supplied by this tool.',
      'Do not mark any idea recommended or pilot_ready without comparing competing page bodies and independent falsification.'],
    writes:0};
}
