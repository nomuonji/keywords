import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { field, firestore, firestoreDocumentName, FirestoreError, value } from '../../db/src/firestore.js';
import { keywordDemand } from '../../keyword-treasury/src/index.js';
import { serpResearchCached } from './remote-keyword-research.js';
import {
  MARKET_SENSOR_SOURCE_IDS,
  marketSignalScan,
  type MarketSignalObservation,
  type MarketSignalScanResult
} from '../../research/src/market-sensors.js';
import {
  DEFAULT_SOCIAL_MARKET_PLATFORMS,
  MARKET_RESEARCH_GOALS,
  SOCIAL_MARKET_PLATFORMS,
  assessMarketEvidenceCoverage,
  socialContentResearch,
  type MarketEvidenceCoverage,
  type MarketResearchGoal,
  type SocialContentObservation,
  type SocialContentResearchResult,
  type SocialMarketPlatform
} from './market-social-research.js';

const REQUEST_TIMEOUT_MS = 12_000;
const snapshotId = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);

export const marketIntelligenceResearchShape = {
  query: z.string().trim().min(1).max(200).optional(),
  geo: z.string().length(2).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  tiktokPeriodDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  hackerNewsFeed: z.enum(['top', 'new', 'best']).optional(),
  includeTopAds: z.boolean().optional(),
  includePinterest: z.boolean().optional(),
  includeAppStore: z.boolean().optional(),
  includeSocialContent: z.boolean().optional(),
  socialPlatforms: z.array(z.enum(SOCIAL_MARKET_PLATFORMS)).min(1).max(3).optional(),
  researchGoal: z.enum(MARKET_RESEARCH_GOALS).optional()
};

export const marketSignalSnapshotSaveShape = {
  id: snapshotId.optional(),
  label: z.string().trim().min(1).max(200).optional(),
  ...marketIntelligenceResearchShape
};

export const marketSignalSnapshotCompareShape = {
  snapshotId,
  rightSnapshotId: snapshotId.optional(),
  query: z.string().trim().min(1).max(200).optional(),
  geo: z.string().length(2).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  tiktokPeriodDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  hackerNewsFeed: z.enum(['top', 'new', 'best']).optional(),
  includeTopAds: z.boolean().optional(),
  includePinterest: z.boolean().optional(),
  includeAppStore: z.boolean().optional(),
  includeSocialContent: z.boolean().optional(),
  socialPlatforms: z.array(z.enum(SOCIAL_MARKET_PLATFORMS)).min(1).max(3).optional(),
  researchGoal: z.enum(MARKET_RESEARCH_GOALS).optional()
};


export interface MarketingMechanicEvidence {
  mechanic: string;
  count: number;
  evidence: Array<{
    source: string;
    label: string;
    excerpt: string;
    url: string | null;
  }>;
}

export interface TopAdObservation {
  key: string;
  label: string;
  url: string;
  description: string;
  likes: number | null;
  likesText: string | null;
  ctrTopPercent: number | null;
  budget: string | null;
  mechanics: string[];
}

export interface AppStoreObservation {
  key: string;
  label: string;
  url: string | null;
  seller: string | null;
  primaryGenre: string | null;
  descriptionExcerpt: string | null;
  price: number | null;
  currency: string | null;
  rating: number | null;
  ratingCount: number | null;
  currentVersionReleaseDate: string | null;
}

export interface PinterestObservation {
  key: string;
  label: string;
  url: string;
  metrics: Record<string, number | string | boolean | null>;
}

export type MarketIntentId =
  | 'problem_need'
  | 'solution_product'
  | 'how_to'
  | 'commercial'
  | 'entity'
  | 'investment'
  | 'career_qualification'
  | 'news'
  | 'research_information'
  | 'ambiguous';

export type MarketIntentRole = 'primary' | 'contextual' | 'adjacent_market' | 'out_of_scope';

export interface IntentClassification {
  primaryIntent: MarketIntentId;
  secondaryIntents: MarketIntentId[];
  matchedSignals: string[];
  basis: 'exact_seed' | 'explicit_rule' | 'generic_default';
}

export interface QueryDemandObservation {
  keyword: string;
  avgMonthlySearches: number | null;
  averageCpcMicros: number | null;
  competition: string | number | null;
  competitionIndex: number | null;
  monthlySearchVolumes: Array<{ year: number; month: number; searches: number }>;
}

export interface MarketIntentBranch {
  intent: MarketIntentId;
  role: MarketIntentRole;
  rationale: string;
  relatedSearches: string[];
  peopleAlsoAsk: string[];
  topResults: Array<{ position: number | null; title: string; link: string; snippet: string | null }>;
  externalSignals: Array<{ source: string; label: string; url: string | null }>;
  demand: QueryDemandObservation[];
  observedDemandSum: number | null;
}

export interface QueryIntentTree {
  query: string | null;
  queryClassification: IntentClassification | null;
  targetIntents: MarketIntentId[];
  mixedIntent: boolean;
  senseSelectionRequired: boolean;
  senseGuidance: string[];
  branches: MarketIntentBranch[];
  primaryEvidenceKeywords: string[];
  excludedFromPrimaryThesis: Array<{ label: string; intent: MarketIntentId; reason: string }>;
  guidance: string[];
}

export interface QueryFocusResearch {
  mode: 'market_scan' | 'hypothesis_led';
  query: string | null;
  searchSurface: {
    source: 'serp';
    query: string | null;
    relatedSearches: string[];
    peopleAlsoAsk: string[];
    topResults: Array<{ position: number | null; title: string; link: string; snippet: string | null }>;
    cacheHit: boolean | null;
    warnings: string[];
  };
  searchDemand: {
    source: 'google_ads';
    query: string | null;
    researchedKeywords: string[];
    results: QueryDemandObservation[];
    warnings: string[];
  };
  intentTree: QueryIntentTree;
}

export interface ObservedMarketCluster {
  label: string;
  evidenceCount: number;
  contextualEvidenceCount: number;
  platforms: SocialMarketPlatform[];
  discoveryQueries: string[];
  formatSignals: string[];
  metricEvidenceCount: number;
  evidence: Array<{
    platform: SocialMarketPlatform;
    title: string;
    url: string;
    views: number | null;
    likes: number | null;
  }>;
}

export interface ValidatedMarketCandidate {
  clusterLabel: string;
  query: string;
  discoveryEvidenceCount: number;
  discoveryContextualEvidenceCount: number;
  discoveryPlatforms: SocialMarketPlatform[];
  coverage: MarketEvidenceCoverage;
  searchDemand: QueryDemandObservation[];
  searchSurface: {
    relatedSearches: string[];
    peopleAlsoAsk: string[];
    topResults: Array<{ position: number | null; title: string; link: string; snippet: string | null }>;
  };
  socialContent: {
    observations: SocialContentObservation[];
    formatSummary: SocialContentResearchResult['formatSummary'];
  };
}

export interface BroadMarketDiscovery {
  mode: 'not_applicable' | 'generic_social_to_validated_clusters';
  status: 'not_applicable' | 'available' | 'partial' | 'unavailable';
  genericQueries: string[];
  socialContent: SocialContentResearchResult;
  clusters: ObservedMarketCluster[];
  validatedCandidates: ValidatedMarketCandidate[];
  warnings: string[];
  guidance: string[];
}

export interface MarketIntelligencePacket {
  fetchedAt: string;
  query: string | null;
  geo: string;
  signals: MarketSignalScanResult;
  queryFocus: QueryFocusResearch;
  socialContent: SocialContentResearchResult;
  coverage: MarketEvidenceCoverage;
  marketDiscovery: BroadMarketDiscovery;
  creativeEvidence: {
    source: 'tiktok_top_ads';
    scope: 'cross_category_reference';
    url: string;
    observations: TopAdObservation[];
    mechanics: MarketingMechanicEvidence[];
    warnings: string[];
  };
  pinterest: {
    source: 'pinterest_trends';
    url: string;
    observations: PinterestObservation[];
    warnings: string[];
  };
  commercialization: {
    source: 'app_store';
    applicability: 'relevant' | 'not_applicable';
    evidenceScope: 'lexical_search_only';
    query: string | null;
    url: string | null;
    totalCount: number | null;
    observations: AppStoreObservation[];
    metrics: {
      observedAppCount: number;
      paidAppCount: number;
      medianPrice: number | null;
      medianRatingCount: number | null;
      medianRating: number | null;
    };
    warnings: string[];
  };
  thesisFrame: {
    evidenceBySignal: Record<string, Array<{ source: string; label: string; fact: string; url: string | null }>>;
    strongestMechanics: Array<{ mechanic: string; count: number }>;
    commercializationFacts: string[];
    contradictionsAndUnknowns: string[];
    requiredAgentOutput: string[];
  };
  warnings: string[];
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

function stripTags(value: string): string {
  return decodeHtml(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function humanNumber(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replaceAll(',', '').trim().toUpperCase();
  const match = cleaned.match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMB])?\+?$/);
  if (!match?.[1]) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const multiplier = match[2] === 'K' ? 1_000 : match[2] === 'M' ? 1_000_000 : match[2] === 'B' ? 1_000_000_000 : 1;
  return Math.round(base * multiplier);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalizeKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/^#/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, '-').slice(0, 160);
}

const INTENT_RULES: Array<{ intent: MarketIntentId; patterns: RegExp[]; signals: string[] }> = [
  {
    intent: 'entity',
    patterns: [
      /株式\s*会社|合同\s*会社|有限\s*会社/i,
      /\b(?:corp\.?|corporation|llc|ltd\.?|company)\b/i,
      /\binc(?:orporated|\.)?(?=\s|$|[,;:()])/i,
      /どのような会社|会社の評判|企業情報|会社概要/i
    ],
    signals: ['company/entity marker']
  },
  {
    intent: 'investment',
    patterns: [/銘柄|株価|株式(?!\s*会社)|投資|上場|時価総額|配当|\b(?:stocks?|shares?|invest(?:ment|or|ing)|ticker)\b/i],
    signals: ['investment marker']
  },
  {
    intent: 'career_qualification',
    patterns: [/資格|試験|検定|求人|転職|採用|キャリア|研修|講座|スクール|教室|学校|\b(?:certification|certificate|exam|career|jobs?|salary|hiring|course|training|school|class)\b/i],
    signals: ['career/qualification marker']
  },
  {
    intent: 'news',
    patterns: [/ニュース|速報|最新情報|事件|発表|\b(?:news|breaking|today|latest update)\b/i],
    signals: ['news/current-event marker']
  },
  {
    intent: 'commercial',
    patterns: [/価格|料金|費用|比較|おすすめ|ランキング|評判|レビュー|口コミ|無料|有料|購入|販売|見積もり|見積り|金利|相場|最安|予約|申込|導入費|どれがいい|どっち|どちら|選び方|\b(?:price|pricing|cost|best|compare|comparison|review|reviews|free|paid|buy|purchase|quote|booking)\b/i],
    signals: ['commercial-evaluation marker']
  },
  {
    intent: 'problem_need',
    patterns: [/問題|課題|リスク|危険|脅威|情報漏洩|漏えい|侵害|被害|脆弱|攻撃|不安|怖い|困る|できない|動かない|エラー|故障|トラブル|悩み|\b(?:problem|risk|threat|breach|leak|vulnerab|attack|danger|concern|pain|error|fail(?:ed|ure)?|broken)\w*\b/i],
    signals: ['problem/risk marker']
  },
  {
    intent: 'solution_product',
    patterns: [/対策|防止|保護|セキュア|ツール|アプリ|製品|サービス|ソフト|システム|テンプレート|プラグイン|拡張機能|参考書|教材|テキスト|治療|クリニック|薬|VPN|ファイアウォール|ローカルLLM|\b(?:solution|tool|app|software|service|product|template|plugin|extension|protect|prevention|secure|security system|firewall|vpn|local llm)\b/i],
    signals: ['solution/product marker']
  },
  {
    intent: 'how_to',
    patterns: [/方法|やり方|使い方|設定|手順|実装|構築|導入方法|始め方|作り方|勉強法|学び方|攻略|手続き|\b(?:how to|setup|set up|guide to|tutorial|configure|implementation|workflow|steps?)\b/i],
    signals: ['how-to marker']
  },
  {
    intent: 'research_information',
    patterns: [/とは|意味|違い|仕組み|定義|ガイドライン|ガイダンス|事例|レポート|調査|研究|論文|カンファレンス|メリット|デメリット|効果|原因|一覧|審査|\b(?:what is|definition|difference|guideline|guidance|report|research|paper|conference|case study|pros?|cons?|benefits?|effects?|causes?|overview)\b/i],
    signals: ['informational/research marker']
  }
];

const INTENT_PRIORITY: MarketIntentId[] = [
  'entity',
  'investment',
  'career_qualification',
  'news',
  'commercial',
  'problem_need',
  'solution_product',
  'how_to',
  'research_information',
  'ambiguous'
];

export function classifyMarketIntent(text: string, exactSeed?: string | null): IntentClassification {
  const normalized = text.normalize('NFKC').trim();
  const exact = exactSeed && normalized.toLowerCase() === exactSeed.normalize('NFKC').trim().toLowerCase();
  const matches: Array<{ intent: MarketIntentId; signals: string[] }> = [];

  for (const rule of INTENT_RULES) {
    const matched = rule.patterns.some(pattern => pattern.test(normalized));
    if (matched) matches.push({ intent: rule.intent, signals: rule.signals });
  }

  const intents = [...new Set(matches.map(item => item.intent))];
  const primaryIntent = INTENT_PRIORITY.find(intent => intents.includes(intent)) ?? 'ambiguous';
  return {
    primaryIntent,
    secondaryIntents: intents.filter(intent => intent !== primaryIntent),
    matchedSignals: [...new Set(matches.flatMap(item => item.signals))],
    basis: exact ? 'exact_seed' : matches.length ? 'explicit_rule' : 'generic_default'
  };
}

function targetIntentsForQuery(query: string): MarketIntentId[] {
  const classification = classifyMarketIntent(query, query);
  if (classification.primaryIntent !== 'ambiguous') {
    return [...new Set([classification.primaryIntent, ...classification.secondaryIntents.filter(intent => intent !== 'ambiguous')])];
  }
  return [];
}

function intentRole(intent: MarketIntentId, targetIntents: MarketIntentId[]): MarketIntentRole {
  if (targetIntents.includes(intent)) return 'primary';
  if (intent === 'career_qualification' || intent === 'investment') return 'adjacent_market';
  if (intent === 'entity') return 'out_of_scope';
  return 'contextual';
}

export function selectQueryDemandSeeds(query: string, relatedSearches: string[], maxSeeds = 10): string[] {
  const targetIntents = targetIntentsForQuery(query);
  const relatedForDemand = relatedSearches
    .filter(value => value.length <= 120)
    .map(value => {
      const classification = classifyMarketIntent(value, query);
      return {
        value,
        intent: classification.primaryIntent,
        role: intentRole(classification.primaryIntent, targetIntents)
      };
    });

  const selected = (() => {
    if (targetIntents.length > 0) {
      return [
        ...relatedForDemand.filter(item => item.role === 'primary').map(item => item.value).slice(0, 6),
        ...relatedForDemand.filter(item => item.role === 'contextual').map(item => item.value).slice(0, 1),
        ...relatedForDemand.filter(item => item.role === 'adjacent_market').map(item => item.value).slice(0, 2),
        ...relatedForDemand.filter(item => item.role === 'out_of_scope').map(item => item.value).slice(0, 1)
      ];
    }

    const intentOrder: MarketIntentId[] = [
      'problem_need',
      'solution_product',
      'how_to',
      'commercial',
      'career_qualification',
      'investment',
      'research_information',
      'news',
      'ambiguous'
    ];
    const grouped = new Map<MarketIntentId, string[]>();
    for (const item of relatedForDemand) {
      if (item.role === 'out_of_scope') continue;
      const list = grouped.get(item.intent) ?? [];
      list.push(item.value);
      grouped.set(item.intent, list);
    }
    const balanced: string[] = [];
    for (let round = 0; balanced.length < Math.max(0, maxSeeds - 1); round++) {
      let added = false;
      for (const intent of intentOrder) {
        const value = grouped.get(intent)?.[round];
        if (!value) continue;
        balanced.push(value);
        added = true;
        if (balanced.length >= Math.max(0, maxSeeds - 1)) break;
      }
      if (!added) break;
    }
    return balanced;
  })();

  return [...new Set([query, ...selected])].slice(0, maxSeeds);
}

function roleRationale(intent: MarketIntentId, role: MarketIntentRole): string {
  if (role === 'primary') return 'Directly matches the query intent selected for market-thesis evidence.';
  if (role === 'contextual') return 'Useful for interpretation, but should not establish the core demand thesis by itself.';
  if (role === 'adjacent_market') return 'Represents a distinct monetizable/search market that should be analyzed separately before it influences the main thesis.';
  return intent === 'entity'
    ? 'Entity/company-specific navigation is preserved but excluded from the generic market thesis unless the original query is entity-specific.'
    : 'Preserved for provenance but excluded from the primary thesis.';
}

export function buildQueryIntentTree(input: {
  query: string | null;
  relatedSearches: string[];
  peopleAlsoAsk: string[];
  topResults: Array<{ position: number | null; title: string; link: string; snippet: string | null }>;
  demand: QueryDemandObservation[];
}): QueryIntentTree {
  if (!input.query) {
    return {
      query: null,
      queryClassification: null,
      targetIntents: [],
      mixedIntent: false,
      senseSelectionRequired: false,
      senseGuidance: ['No query supplied; semantic-sense selection is not applicable in broad market-scan mode.'],
      branches: [],
      primaryEvidenceKeywords: [],
      excludedFromPrimaryThesis: [],
      guidance: ['No query supplied; intent decomposition is only used in hypothesis-led query mode.']
    };
  }

  const queryClassification = classifyMarketIntent(input.query, input.query);
  const targetIntents = targetIntentsForQuery(input.query);
  const demandByKeyword = new Map(input.demand.map(item => [item.keyword.normalize('NFKC').trim().toLowerCase(), item]));
  const branchMap = new Map<MarketIntentId, MarketIntentBranch>();

  const ensureBranch = (intent: MarketIntentId) => {
    const current = branchMap.get(intent);
    if (current) return current;
    const role = intentRole(intent, targetIntents);
    const created: MarketIntentBranch = {
      intent,
      role,
      rationale: roleRationale(intent, role),
      relatedSearches: [],
      peopleAlsoAsk: [],
      topResults: [],
      externalSignals: [],
      demand: [],
      observedDemandSum: null
    };
    branchMap.set(intent, created);
    return created;
  };

  const exactSeedKey = input.query.normalize('NFKC').trim().toLowerCase();
  const seedDemand = demandByKeyword.get(exactSeedKey);
  const seedBranch = ensureBranch(queryClassification.primaryIntent);
  if (seedDemand) seedBranch.demand.push(seedDemand);

  for (const label of input.relatedSearches) {
    const classification = classifyMarketIntent(label, input.query);
    ensureBranch(classification.primaryIntent).relatedSearches.push(label);
  }
  for (const label of input.peopleAlsoAsk) {
    const classification = classifyMarketIntent(label, input.query);
    ensureBranch(classification.primaryIntent).peopleAlsoAsk.push(label);
  }
  for (const result of input.topResults) {
    const classification = classifyMarketIntent([result.title, result.snippet].filter(Boolean).join(' '), input.query);
    ensureBranch(classification.primaryIntent).topResults.push(result);
  }
  for (const demand of input.demand) {
    if (demand.keyword.normalize('NFKC').trim().toLowerCase() === exactSeedKey) continue;
    const classification = classifyMarketIntent(demand.keyword, input.query);
    ensureBranch(classification.primaryIntent).demand.push(demand);
  }

  const branches = INTENT_PRIORITY.flatMap(intent => {
    const branch = branchMap.get(intent);
    if (!branch) return [];
    const knownVolumes = branch.demand.flatMap(item => typeof item.avgMonthlySearches === 'number' ? [item.avgMonthlySearches] : []);
    return [{
      ...branch,
      observedDemandSum: knownVolumes.length ? knownVolumes.reduce((sum, value) => sum + value, 0) : null
    }];
  });

  const primaryEvidenceKeywords = [...new Set([
    input.query,
    ...branches
      .filter(branch => branch.role === 'primary')
      .flatMap(branch => [
        ...branch.relatedSearches,
        ...branch.demand.map(item => item.keyword)
      ])
  ])];

  const excludedFromPrimaryThesis = branches
    .filter(branch => branch.role === 'adjacent_market' || branch.role === 'out_of_scope')
    .flatMap(branch => [
      ...branch.relatedSearches.map(label => ({ label, intent: branch.intent, reason: branch.rationale })),
      ...branch.peopleAlsoAsk.map(label => ({ label, intent: branch.intent, reason: branch.rationale })),
      ...branch.demand.map(item => ({ label: item.keyword, intent: branch.intent, reason: branch.rationale }))
    ])
    .filter((item, index, all) => all.findIndex(other => other.label === item.label && other.intent === item.intent) === index)
    .slice(0, 30);

  const populatedIntents = branches.filter(branch =>
    branch.relatedSearches.length || branch.peopleAlsoAsk.length || branch.topResults.length || branch.externalSignals.length || branch.demand.length
  );
  const senseSelectionRequired = queryClassification.primaryIntent === 'ambiguous' && populatedIntents.length > 0;

  return {
    query: input.query,
    queryClassification,
    targetIntents,
    mixedIntent: populatedIntents.length > 1,
    senseSelectionRequired,
    senseGuidance: senseSelectionRequired
      ? [
          'The root query has no explicit intent marker, so no market branch is promoted to primary yet.',
          'Before writing a thesis, choose the semantic sense/intent supported by the evidence and re-run market_intelligence_research with an intent-bearing query.',
          'Verify that supporting SERP/app evidence uses the same meaning. A shared phrase or brand name is not enough to merge distinct categories or use cases.'
        ]
      : ['The root query has an explicit intent or does not currently show enough branch diversity to require separate sense selection.'],
    branches,
    primaryEvidenceKeywords,
    excludedFromPrimaryThesis,
    guidance: [
      'Do not sum or compare demand across different intent branches as if they were one market.',
      'Primary branches may support the main market thesis; contextual branches may explain it but should not establish it alone.',
      'Adjacent-market branches are retained as separate opportunity surfaces and require their own validation before becoming a thesis.',
      'Entity-specific branches stay out of a generic market thesis unless the original query itself is entity-specific.'
    ]
  };
}

export function attachQuerySignalsToIntentTree(queryFocus: QueryFocusResearch, signals: MarketSignalScanResult): QueryFocusResearch {
  if (queryFocus.mode !== 'hypothesis_led' || !queryFocus.query) return queryFocus;

  const branches = queryFocus.intentTree.branches.map(branch => ({
    ...branch,
    relatedSearches: [...branch.relatedSearches],
    peopleAlsoAsk: [...branch.peopleAlsoAsk],
    topResults: [...branch.topResults],
    externalSignals: [...branch.externalSignals],
    demand: [...branch.demand]
  }));
  const branchMap = new Map(branches.map(branch => [branch.intent, branch]));
  const ensureBranch = (intent: MarketIntentId) => {
    const current = branchMap.get(intent);
    if (current) return current;
    const role = intentRole(intent, queryFocus.intentTree.targetIntents);
    const created: MarketIntentBranch = {
      intent,
      role,
      rationale: roleRationale(intent, role),
      relatedSearches: [],
      peopleAlsoAsk: [],
      topResults: [],
      externalSignals: [],
      demand: [],
      observedDemandSum: null
    };
    branches.push(created);
    branchMap.set(intent, created);
    return created;
  };

  for (const result of signals.results) {
    for (const observation of result.observations) {
      const classification = classifyMarketIntent(observation.label, queryFocus.query);
      ensureBranch(classification.primaryIntent).externalSignals.push({
        source: result.source,
        label: observation.label,
        url: observation.url
      });
    }
  }

  branches.sort((left, right) => INTENT_PRIORITY.indexOf(left.intent) - INTENT_PRIORITY.indexOf(right.intent));
  const populated = branches.filter(branch =>
    branch.relatedSearches.length || branch.peopleAlsoAsk.length || branch.topResults.length || branch.externalSignals.length || branch.demand.length
  );

  const excludedSignals = branches
    .filter(branch => branch.role === 'adjacent_market' || branch.role === 'out_of_scope')
    .flatMap(branch => branch.externalSignals.map(signal => ({
      label: signal.label,
      intent: branch.intent,
      reason: branch.rationale
    })));

  return {
    ...queryFocus,
    intentTree: {
      ...queryFocus.intentTree,
      mixedIntent: populated.length > 1,
      branches,
      excludedFromPrimaryThesis: [
        ...queryFocus.intentTree.excludedFromPrimaryThesis,
        ...excludedSignals
      ].filter((item, index, all) => all.findIndex(other => other.label === item.label && other.intent === item.intent) === index).slice(0, 40)
    }
  };
}

async function fetchText(url: string, accept = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8') {
  const response = await fetch(url, {
    headers: {
      accept,
      'accept-language': 'en-US,en;q=0.9,ja;q=0.7',
      'user-agent': 'keywords-market-intelligence/1.0 (+read-only public market research)'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' from ' + new URL(url).hostname);
  return { text: await response.text(), finalUrl: response.url, contentType: response.headers.get('content-type') ?? '' };
}

const MECHANIC_RULES: Array<{ mechanic: string; pattern: RegExp }> = [
  { mechanic: 'comparison', pattern: /\b(compar(?:e|es|ed|ing|ison)|versus|\bvs\b|superior|superiority|difference between|real differences?)\b/i },
  { mechanic: 'social_proof', pattern: /\b(testimonial|testimony|review|customers?|users?|people (?:say|love|share))\b/i },
  { mechanic: 'problem_solution', pattern: /\b(problem|pain|struggle|disturbing situation|annoying|frustrating|solution|solve|fix)\b/i },
  { mechanic: 'demonstration', pattern: /\b(showcase|demonstrat(?:e|ion)|how to|tutorial|step[- ]by[- ]step|in action|use case|feature)\b/i },
  { mechanic: 'transformation', pattern: /\b(before and after|before\/after|transformation|results?|changed?|improvement)\b/i },
  { mechanic: 'curiosity_gap', pattern: /\b(curiosity|secret|you won['’]t believe|what happens|guess|surprising|unknown|reveal)\b/i },
  { mechanic: 'identity_inclusion', pattern: /\b(inclusive|diversity|identity|people like you|customer groups?|community)\b/i },
  { mechanic: 'urgency', pattern: /\b(limited|today only|right now|act now|hurry|last chance|ends? soon)\b/i },
  { mechanic: 'ranking_list', pattern: /\b(top\s+\d+|ranking|ranked|best \d+|\d+ reasons?|list of)\b/i },
  { mechanic: 'immersive_spectacle', pattern: /\b(intense|battle|gameplay|scene|transition|sound effect|cinematic|visual effect)\b/i },
  { mechanic: 'personalization', pattern: /\b(personali[sz]ed|your type|for you|recommend(?:ed|ation)|matched to you|customi[sz]ed)\b/i }
];

export function extractMarketingMechanics(text: string): string[] {
  return MECHANIC_RULES.filter(rule => rule.pattern.test(text)).map(rule => rule.mechanic);
}

export function parseTikTokTopAdsHtml(html: string, sourceUrl: string, limit = 10): TopAdObservation[] {
  const text = stripTags(html);
  const segments = text.split(/\bSee analysis\b|\bSee analytics\b|\b分析を確認する\b/i);
  const observations: TopAdObservation[] = [];

  for (const segment of segments) {
    if (observations.length >= limit) break;
    const metrics = segment.match(/([0-9]+(?:\.[0-9]+)?[KMB]?)\s*(?:Likes|いいね数)\s*Top\s*([0-9]+)%\s*CTR\s*(High|Medium|Low|高|中|低)\s*(?:Budget|予算)/i);
    if (!metrics) continue;
    const metricIndex = metrics.index ?? 0;
    const after = segment.slice(metricIndex + metrics[0].length).trim();
    const before = segment.slice(0, metricIndex).trim();
    const description = (after || before.split(/Top Ads Dashboard|Top Ads Spotlight|トップ広告ダッシュボード|Spotlight広告の上位/i).pop() || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200);
    const mechanics = extractMarketingMechanics(description);
    observations.push({
      key: 'top-ad-' + (observations.length + 1) + '-' + normalizeKey(description.slice(0, 80)),
      label: description ? description.slice(0, 160) : 'TikTok Top Ad ' + (observations.length + 1),
      url: sourceUrl,
      description,
      likes: humanNumber(metrics[1] ?? null),
      likesText: metrics[1] ?? null,
      ctrTopPercent: metrics[2] ? Number(metrics[2]) : null,
      budget: metrics[3] ?? null,
      mechanics
    });
  }

  return observations;
}

async function tiktokTopAds(geo: string, limit: number) {
  const regionalUrl = 'https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?region=' + encodeURIComponent(geo);
  const spotlightUrl = 'https://ads.tiktok.com/business/creativecenter/tiktok-topads-spotlight/pc/en';
  const urls = [regionalUrl, spotlightUrl];
  const warnings: string[] = [];
  for (const url of urls) {
    try {
      const response = await fetchText(url);
      const observations = parseTikTokTopAdsHtml(response.text, response.finalUrl, limit);
      if (observations.length) {
        if (url === spotlightUrl) warnings.push('Regional Top Ads exposed no parseable server-rendered cards; using global Top Ads Spotlight creative examples as fallback.');
        return { url: response.finalUrl, observations, warnings };
      }
      warnings.push('TikTok Top Ads page loaded but exposed no parseable public ad cards at ' + url);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { url: regionalUrl, observations: [] as TopAdObservation[], warnings };
}

function mechanicsSummary(observations: TopAdObservation[]): MarketingMechanicEvidence[] {
  const grouped = new Map<string, MarketingMechanicEvidence>();
  for (const observation of observations) {
    for (const mechanic of observation.mechanics) {
      const current = grouped.get(mechanic) ?? { mechanic, count: 0, evidence: [] };
      current.count += 1;
      if (current.evidence.length < 5) {
        current.evidence.push({
          source: 'tiktok_top_ads',
          label: observation.label,
          excerpt: observation.description.slice(0, 500),
          url: observation.url
        });
      }
      grouped.set(mechanic, current);
    }
  }
  return [...grouped.values()].sort((left, right) => right.count - left.count || left.mechanic.localeCompare(right.mechanic));
}

async function appStoreResearch(query: string | null, geo: string, limit: number) {
  if (!query) {
    return {
      source: 'app_store' as const,
      evidenceScope: 'lexical_search_only' as const,
      applicability: 'not_applicable' as const,
      query,
      url: null,
      totalCount: null,
      observations: [] as AppStoreObservation[],
      metrics: { observedAppCount: 0, paidAppCount: 0, medianPrice: null, medianRatingCount: null, medianRating: null },
      warnings: ['App Store commercialization check requires a query.']
    };
  }
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', query);
  url.searchParams.set('country', geo.toLowerCase());
  url.searchParams.set('entity', 'software');
  url.searchParams.set('limit', String(limit));
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'keywords-market-intelligence/1.0' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error('HTTP ' + response.status + ' from itunes.apple.com');
    const raw = await response.json() as { resultCount?: number; results?: Array<Record<string, unknown>> };
    const observations = (raw.results ?? []).slice(0, limit).flatMap((item): AppStoreObservation[] => {
      const id = typeof item.trackId === 'number' ? String(item.trackId) : '';
      const label = typeof item.trackName === 'string' ? item.trackName : '';
      if (!id || !label) return [];
      return [{
        key: 'app-' + id,
        label,
        url: typeof item.trackViewUrl === 'string' ? item.trackViewUrl : null,
        seller: typeof item.sellerName === 'string' ? item.sellerName : null,
        primaryGenre: typeof item.primaryGenreName === 'string' ? item.primaryGenreName : null,
        descriptionExcerpt: typeof item.description === 'string'
          ? item.description.replace(/\s+/g, ' ').trim().slice(0, 600)
          : null,
        price: typeof item.price === 'number' ? item.price : null,
        currency: typeof item.currency === 'string' ? item.currency : null,
        rating: typeof item.averageUserRating === 'number' ? item.averageUserRating : null,
        ratingCount: typeof item.userRatingCount === 'number' ? item.userRatingCount : null,
        currentVersionReleaseDate: typeof item.currentVersionReleaseDate === 'string' ? item.currentVersionReleaseDate : null
      }];
    });
    const prices = observations.flatMap(item => item.price === null ? [] : [item.price]);
    const ratingCounts = observations.flatMap(item => item.ratingCount === null ? [] : [item.ratingCount]);
    const ratings = observations.flatMap(item => item.rating === null ? [] : [item.rating]);
    return {
      source: 'app_store' as const,
      evidenceScope: 'lexical_search_only' as const,
      applicability: 'relevant' as const,
      query,
      url: url.toString(),
      totalCount: typeof raw.resultCount === 'number' ? raw.resultCount : observations.length,
      observations,
      metrics: {
        observedAppCount: observations.length,
        paidAppCount: observations.filter(item => (item.price ?? 0) > 0).length,
        medianPrice: median(prices),
        medianRatingCount: median(ratingCounts),
        medianRating: median(ratings)
      },
      warnings: [] as string[]
    };
  } catch (error) {
    return {
      source: 'app_store' as const,
      evidenceScope: 'lexical_search_only' as const,
      applicability: 'relevant' as const,
      query,
      url: url.toString(),
      totalCount: null,
      observations: [] as AppStoreObservation[],
      metrics: { observedAppCount: 0, paidAppCount: 0, medianPrice: null, medianRatingCount: null, medianRating: null },
      warnings: [error instanceof Error ? error.message : String(error)]
    };
  }
}

export function appStoreRelevantForQuery(query: string | null): boolean {
  if (!query) return false;
  const classification = classifyMarketIntent(query, query);
  const explicitIntents = new Set([classification.primaryIntent, ...classification.secondaryIntents]);
  if (explicitIntents.has('solution_product') || explicitIntents.has('commercial') || explicitIntents.has('how_to') || explicitIntents.has('problem_need')) {
    return true;
  }
  return !['entity', 'investment', 'news', 'research_information'].includes(classification.primaryIntent);
}

export function parsePinterestTrendsHtml(html: string, sourceUrl: string, limit = 20): PinterestObservation[] {
  const observations: PinterestObservation[] = [];
  const seen = new Set<string>();
  const patterns = [
    /"(?:keyword|term|search_query|query)"\s*:\s*"([^"\\]{2,120})"/gi,
    /"(?:name|title)"\s*:\s*"([^"\\]{2,120})"\s*,\s*"(?:trend|growth|volume)/gi
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      if (observations.length >= limit) return observations;
      const label = decodeHtml(match[1] ?? '').trim();
      const key = normalizeKey(label);
      if (!key || seen.has(key) || /^(pinterest|trends?|search)$/i.test(label)) continue;
      seen.add(key);
      observations.push({ key: 'pinterest-' + key, label, url: sourceUrl, metrics: {} });
    }
  }
  return observations;
}

async function pinterestTrends(query: string | null, geo: string, limit: number) {
  const url = new URL('https://trends.pinterest.com/');
  url.searchParams.set('country', geo);
  if (query) url.searchParams.set('searchTerm', query);
  try {
    const response = await fetchText(url.toString());
    const observations = parsePinterestTrendsHtml(response.text, response.finalUrl, limit);
    return {
      source: 'pinterest_trends' as const,
      url: response.finalUrl,
      observations,
      warnings: observations.length ? [] : ['Pinterest Trends public page loaded but exposed no parseable trend payload; official Trends API access is restricted, so this source remains best-effort.']
    };
  } catch (error) {
    return {
      source: 'pinterest_trends' as const,
      url: url.toString(),
      observations: [] as PinterestObservation[],
      warnings: [error instanceof Error ? error.message : String(error)]
    };
  }
}

async function queryFocusedResearch(query: string | null, geo: string, limit: number): Promise<QueryFocusResearch> {
  if (!query) {
    return {
      mode: 'market_scan',
      query: null,
      searchSurface: {
        source: 'serp',
        query: null,
        relatedSearches: [],
        peopleAlsoAsk: [],
        topResults: [],
        cacheHit: null,
        warnings: ['No query supplied; broad market-scan mode does not run hypothesis-led SERP research.']
      },
      searchDemand: {
        source: 'google_ads',
        query: null,
        researchedKeywords: [],
        results: [],
        warnings: ['No query supplied; broad market-scan mode does not run exact/adjacent keyword demand research.']
      },
      intentTree: buildQueryIntentTree({
        query: null,
        relatedSearches: [],
        peopleAlsoAsk: [],
        topResults: [],
        demand: []
      })
    };
  }

  const surfaceWarnings: string[] = [];
  let relatedSearches: string[] = [];
  let peopleAlsoAsk: string[] = [];
  let topResults: Array<{ position: number | null; title: string; link: string; snippet: string | null }> = [];
  let cacheHit: boolean | null = null;

  try {
    let serp: any;
    let primaryError: string | null = null;
    try {
      serp = await serpResearchCached({
        query,
        country: geo,
        language: geo === 'JP' ? 'ja' : 'en',
        num: Math.min(limit, 10),
        provider: 'api',
        forceRefresh: false,
        maxCacheAgeHours: 72
      }) as any;
    } catch (error) {
      primaryError = error instanceof Error ? error.message : String(error);
      try {
        serp = await serpResearchCached({
          query,
          country: geo,
          language: geo === 'JP' ? 'ja' : 'en',
          num: Math.min(limit, 10),
          provider: 'brave',
          forceRefresh: false,
          maxCacheAgeHours: 72
        }) as any;
        surfaceWarnings.push('Primary SERP API failed; Brave fallback supplied the query surface: ' + primaryError);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error('primary API failed: ' + primaryError + '; Brave fallback failed: ' + fallbackMessage);
      }
    }

    relatedSearches = Array.isArray(serp.relatedSearches)
      ? serp.relatedSearches.map((value: unknown) => String(value).trim()).filter(Boolean).slice(0, 12)
      : [];
    peopleAlsoAsk = Array.isArray(serp.peopleAlsoAsk)
      ? serp.peopleAlsoAsk.map((value: unknown) => String(value).trim()).filter(Boolean).slice(0, 12)
      : [];
    topResults = Array.isArray(serp.results)
      ? serp.results.slice(0, Math.min(limit, 10)).map((item: any) => ({
          position: typeof item?.position === 'number' ? item.position : null,
          title: String(item?.title ?? ''),
          link: String(item?.link ?? ''),
          snippet: item?.snippet == null ? null : String(item.snippet)
        })).filter((item: { title: string; link: string }) => item.title && item.link)
      : [];
    cacheHit = typeof serp.cache?.hit === 'boolean' ? serp.cache.hit : null;
  } catch (error) {
    surfaceWarnings.push('Query-focused SERP research failed: ' + (error instanceof Error ? error.message : String(error)));
  }

  const demandWarnings: string[] = [];
  const demandSeeds = selectQueryDemandSeeds(query, relatedSearches, 10);

  let demandResults: QueryFocusResearch['searchDemand']['results'] = [];
  if (geo !== 'JP') {
    demandWarnings.push('Query-focused Google Ads demand expansion currently uses the configured Japan targeting only, so demand lookup is skipped when geo is not JP.');
  } else {
    try {
      const demand = await keywordDemand({
        keywords: demandSeeds,
        languageConstant: '1005',
        geoTargetConstants: ['2392'],
        includeAdultKeywords: true
      }) as any;
      demandResults = Array.isArray(demand?.results)
        ? demand.results.map((item: any) => ({
            keyword: String(item?.keyword ?? ''),
            avgMonthlySearches: typeof item?.avgMonthlySearches === 'number' ? item.avgMonthlySearches : null,
            averageCpcMicros: typeof item?.averageCpcMicros === 'number' ? item.averageCpcMicros : null,
            competition: typeof item?.competition === 'string' || typeof item?.competition === 'number' ? item.competition : null,
            competitionIndex: typeof item?.competitionIndex === 'number' ? item.competitionIndex : null,
            monthlySearchVolumes: Array.isArray(item?.monthlySearchVolumes)
              ? item.monthlySearchVolumes.flatMap((month: any) =>
                  typeof month?.year === 'number' && typeof month?.month === 'number' && typeof month?.searches === 'number'
                    ? [{ year: month.year, month: month.month, searches: month.searches }]
                    : []
                )
              : []
          })).filter((item: { keyword: string }) => Boolean(item.keyword))
        : [];
    } catch (error) {
      demandWarnings.push('Query-focused Google Ads demand research failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  return {
    mode: 'hypothesis_led',
    query,
    searchSurface: {
      source: 'serp',
      query,
      relatedSearches,
      peopleAlsoAsk,
      topResults,
      cacheHit,
      warnings: surfaceWarnings
    },
    searchDemand: {
      source: 'google_ads',
      query,
      researchedKeywords: demandSeeds,
      results: demandResults,
      warnings: demandWarnings
    },
    intentTree: buildQueryIntentTree({
      query,
      relatedSearches,
      peopleAlsoAsk,
      topResults,
      demand: demandResults
    })
  };
}


const GENERIC_MARKET_DISCOVERY_QUERIES_JA = [
  '初めて やってみた',
  '最近 ハマってる',
  '一人で 行ってみた',
  '困った 解決',
  'やめてよかった',
  '買ってよかった'
] as const;

const GENERIC_MARKET_DISCOVERY_QUERIES_EN = [
  'tried for the first time',
  'recently obsessed with',
  'went alone first time',
  'struggled with solution',
  'glad I quit',
  'worth buying'
] as const;

const GENERIC_MARKET_LABEL_STOPWORDS = new Set([
  'おすすめ', 'おすすめ商品', 'おすすめアイテム', 'おすすめグッズ', '人気', '人気商品',
  '商品', '商品紹介', '紹介', '購入品', '購入品紹介', '買ってよかった', '買って良かった',
  '買ってよかったもの', '買って良かったもの', '買ってよかった物', '買って良かった物',
  '買ってよかった商品', '買って良かった商品', 'ランキング', '比較', 'レビュー', '口コミ',
  '話題', '話題のアイテム', '最新', 'ベストバイ', 'bestbuy', 'shorts', 'short',
  'youtube', 'tiktok', 'fyp', 'pr', '広告', 'viral', '便利', '便利アイテム',
  'アイテム', 'グッズ', 'ツール', '無料', 'まとめ', '保存版', '神アイテム', '神商品',
  '名品', 'おすすめガイド', 'オススメ', 'amazon', '楽天', 'rakuten', 'shein',
  'もの', '物', 'こと', '食べ物', '曲', '動画', 'vlog', '日常', 'シリーズ', 'やり方',
  '特徴', '人の特徴'
]);

const GENERIC_MARKET_LABEL_PATTERNS = [
  /^(?:20\d{2}年(?:上半期|下半期|\d+月)?)?(?:に)?(?:買って|買っ?て)(?:よかった|良かった)(?:もの|物|商品|アイテム)?(?:たち)?$/i,
  /^(?:おすすめ|人気|話題|最新|便利|神)(?:商品|アイテム|グッズ|ツール|もの|物)?$/i,
  /^(?:ベストバイ|best\s*buy|ランキング|比較|レビュー|口コミ|まとめ)$/i,
  /^(?:おすすめ)?(?:に)?(?:のりたい|乗りたい|載りたい)$/i,
  /^(?:fyp.*|tiktoks?rp|pr.*)$/i,
  /^top\d+$/i,
  /^こと(?:\d+選|教えて.*|について.*)?$/i
];

function compareObservedMarketClusters(left: ObservedMarketCluster, right: ObservedMarketCluster): number {
  return (
    right.platforms.length - left.platforms.length ||
    right.contextualEvidenceCount - left.contextualEvidenceCount ||
    right.evidenceCount - left.evidenceCount ||
    right.metricEvidenceCount - left.metricEvidenceCount ||
    right.formatSignals.length - left.formatSignals.length ||
    left.label.localeCompare(right.label, 'ja')
  );
}

function hasEnoughObservedMarketEvidence(item: ObservedMarketCluster): boolean {
  // Hashtags are supporting evidence only. A label becomes a broad discovery
  // hypothesis only when at least one observed title/snippet names it in a
  // contextual phrase. The second-stage re-rooted query decides whether that
  // hypothesis has enough independent evidence for a conclusion.
  return item.contextualEvidenceCount >= 1;
}

function normalizeObservedMarketLabel(raw: string): string | null {
  let label = raw.normalize('NFKC')
    .replace(/^#+/, '')
    .replace(/[\[\]【】()（）<>「」『』]/g, '')
    .replace(/[!！?？:：,，。|｜/\\"'“”‘’]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  label = label
    .replace(/^(?:最新|おすすめ|人気|話題の|本当に|マジで|絶対|神|無料|202[0-9]年?)+/i, '')
    .replace(/^(?:初めて|はじめて)(?:の)?/i, '')
    .replace(/おすすめ/gi, '')
    .replace(/(?:購入品紹介|商品紹介|ガジェット紹介|レビュー|好きな人と繋がりたい)$/i, '')
    .replace(/(?:です|でした)$/u, '')
    .replace(/\d+\s*(?:商品|選|個|点)$/u, '')
    .trim();
  if (label.length < 2 || label.length > 28) return null;
  if (!/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/u.test(label)) return null;
  const normalized = label.toLowerCase();
  if (GENERIC_MARKET_LABEL_STOPWORDS.has(normalized) || GENERIC_MARKET_LABEL_STOPWORDS.has(label)) return null;
  if (GENERIC_MARKET_LABEL_PATTERNS.some(pattern => pattern.test(label))) return null;
  return label;
}

function contextualObservedMarketLabelCandidates(text: string): string[] {
  const withoutHashtags = stripTags(text).replace(/#[^\s#|｜,，。!！?？]+/gu, ' ');
  const candidates: string[] = [];
  const phrasePatterns = [
    /買って(?:よかった|良かった)([A-Za-z0-9\u3040-\u30ff\u3400-\u9fffー・]{2,18}?)(?:\d+\s*(?:選|個|点)|を|[!！#、。]|$)/giu,
    /([A-Za-z0-9\u3040-\u30ff\u3400-\u9fffー・]{1,18})をやめて(?:よかった|良かった)/giu,
    /^([A-Za-z0-9\u3040-\u30ff\u3400-\u9fffー・]{2,18})\s+やめて(?:よかった|良かった)/giu,
    /やめて(?:よかった|良かった)([A-Za-z0-9\u3040-\u30ff\u3400-\u9fffー・]{2,18}?)(?:[!！#、。]|$|\s)/giu,
    /([A-Za-z0-9\u3040-\u30ff\u3400-\u9fffー・]{2,18}?)(?:を)?やってみた/giu,
    /最近(?:ハマって(?:る|いる)|ハマった)([A-Za-z0-9\u3040-\u30ff\u3400-\u9fffー・]{2,18}?)(?:[!！#、。]|$|\s)/giu,
    /一人で([A-Za-z0-9\u3040-\u30ff\u3400-\u9fffー・]{2,18}?)(?:に)?行ってみた/giu,
    /(?:ひとり|一人)で([A-Za-z0-9\u3040-\u30ff\u3400-\u9fffー・]{1,10}(?:旅|旅行))/giu,
    /(ひとり旅|一人旅|ソロ活|おひとりさま)/giu,
    /([A-Za-z0-9\u3040-\u30ff\u3400-\u9fffー・]{2,18})(?:に|向け|で)?おすすめ/giu,
    /おすすめ([A-Za-z0-9\u3040-\u30ff\u3400-\u9fffー・]{2,18}?)(?:を|が|で|[!！#、。]|$|\s)/giu,
    /([A-Za-z0-9\u3040-\u30ff\u3400-\u9fffー・]{2,18})(?:を|で)?(?:徹底)?比較/giu,
    /([A-Za-z0-9\u3040-\u30ff\u3400-\u9fffー・]{2,18}?)(?:ランキング|ベスト\d+)/giu
  ];
  for (const pattern of phrasePatterns) {
    for (const match of withoutHashtags.matchAll(pattern)) {
      if (match[1]) candidates.push(match[1]);
    }
  }
  return candidates;
}

export function extractContextualObservedMarketClusterLabels(observation: Pick<SocialContentObservation, 'title' | 'snippet'>): string[] {
  const text = [observation.title, observation.snippet].filter(Boolean).join(' ');
  const normalized = contextualObservedMarketLabelCandidates(text)
    .map(normalizeObservedMarketLabel)
    .filter((value): value is string => Boolean(value));
  return [...new Map(normalized.map(label => [label.toLowerCase(), label])).values()];
}

export function extractObservedMarketClusterLabels(observation: Pick<SocialContentObservation, 'title' | 'snippet'>): string[] {
  const text = [observation.title, observation.snippet].filter(Boolean).join(' ');
  const candidates: string[] = [];

  for (const match of text.matchAll(/#([^\s#|｜,，。!！?？]{2,32})/gu)) {
    if (match[1]) candidates.push(match[1]);
  }
  candidates.push(...contextualObservedMarketLabelCandidates(text));

  const normalized = candidates
    .map(normalizeObservedMarketLabel)
    .filter((value): value is string => Boolean(value));
  return [...new Map(normalized.map(label => [label.toLowerCase(), label])).values()];
}

export function clusterObservedSocialMarkets(observations: SocialContentObservation[]): ObservedMarketCluster[] {
  const grouped = new Map<string, {
    label: string;
    observationUrls: Set<string>;
    contextualUrls: Set<string>;
    platforms: Set<SocialMarketPlatform>;
    discoveryQueries: Set<string>;
    formats: Set<string>;
    metricUrls: Set<string>;
    evidence: ObservedMarketCluster['evidence'];
  }>();

  for (const observation of observations) {
    const labels = extractObservedMarketClusterLabels(observation);
    const contextualKeys = new Set(extractContextualObservedMarketClusterLabels(observation).map(label => label.toLowerCase()));
    for (const label of labels) {
      const key = label.toLowerCase();
      const current = grouped.get(key) ?? {
        label,
        observationUrls: new Set<string>(),
        contextualUrls: new Set<string>(),
        platforms: new Set<SocialMarketPlatform>(),
        discoveryQueries: new Set<string>(),
        formats: new Set<string>(),
        metricUrls: new Set<string>(),
        evidence: []
      };
      current.observationUrls.add(observation.url);
      if (contextualKeys.has(key)) current.contextualUrls.add(observation.url);
      current.platforms.add(observation.platform);
      current.discoveryQueries.add(observation.searchQuery);
      observation.formatSignals.forEach(format => current.formats.add(format));
      if (Object.values(observation.metrics).some(value => value !== null)) current.metricUrls.add(observation.url);
      if (current.evidence.length < 5 && !current.evidence.some(item => item.url === observation.url)) {
        current.evidence.push({
          platform: observation.platform,
          title: observation.title,
          url: observation.url,
          views: observation.metrics.views,
          likes: observation.metrics.likes
        });
      }
      grouped.set(key, current);
    }
  }

  const clusters = [...grouped.values()].map(item => ({
    label: item.label,
    evidenceCount: item.observationUrls.size,
    contextualEvidenceCount: item.contextualUrls.size,
    platforms: [...item.platforms],
    discoveryQueries: [...item.discoveryQueries],
    formatSignals: [...item.formats],
    metricEvidenceCount: item.metricUrls.size,
    evidence: item.evidence
  }));

  return clusters
    .filter(hasEnoughObservedMarketEvidence)
    .sort(compareObservedMarketClusters);
}

function clusterBelongsToDiscoverySeed(cluster: ObservedMarketCluster, seed: string): boolean {
  return cluster.discoveryQueries.some(query => query.includes(seed));
}

export function selectBroadValidationClusters(
  clusters: ObservedMarketCluster[],
  genericQueries: string[],
  maxCandidates = 3
): ObservedMarketCluster[] {
  const selected: ObservedMarketCluster[] = [];
  const used = new Set<string>();

  const add = (cluster: ObservedMarketCluster | undefined) => {
    if (!cluster || selected.length >= maxCandidates) return;
    const key = cluster.label.toLowerCase();
    if (used.has(key)) return;
    used.add(key);
    selected.push(cluster);
  };

  // Pick at most one representative from each discovery lens, then rank those
  // representatives by observed evidence breadth. No market category receives
  // lexical priority: a gadget, beauty item, hobby, behavior, or social ritual
  // must all earn their slot through the same evidence rules.
  const representatives = genericQueries
    .map(seed => clusters.find(cluster => clusterBelongsToDiscoverySeed(cluster, seed)))
    .filter((cluster): cluster is ObservedMarketCluster => Boolean(cluster))
    .sort(compareObservedMarketClusters);

  for (const cluster of representatives) add(cluster);

  // Do not force-fill validation slots from a lens that already contributed a
  // candidate. Returning fewer strong candidates is preferable to manufacturing
  // breadth from repeated variants of the same discovery surface.
  return selected;
}

function emptyBroadMarketDiscovery(platforms: SocialMarketPlatform[]): BroadMarketDiscovery {
  return {
    mode: 'not_applicable',
    status: 'not_applicable',
    genericQueries: [],
    socialContent: {
      source: 'serp_indexed_social_content',
      evidenceScope: 'public_index_plus_best_effort_public_page_metrics',
      query: null,
      platformsRequested: platforms,
      platformsObserved: [],
      observations: [],
      formatSummary: [],
      platformStatus: [],
      warnings: [],
      guidance: []
    },
    clusters: [],
    validatedCandidates: [],
    warnings: [],
    guidance: ['Generic social market discovery runs only when market_intelligence_research is called without a query.']
  };
}

function rerootDiscoveredMarketQuery(label: string, geo: string): string {
  return geo === 'JP' ? label + ' おすすめ' : 'best ' + label;
}

export function mergeBroadDiscoveryObservations(
  results: SocialContentResearchResult[],
  maxObservations = 30
): SocialContentObservation[] {
  const observations: SocialContentObservation[] = [];
  const seenUrls = new Set<string>();
  const maxDepth = results.reduce((max, result) => Math.max(max, result.observations.length), 0);

  // Round-robin across discovery lenses so array order cannot silently make the
  // earliest lens consume the observation cap.
  for (let index = 0; index < maxDepth && observations.length < maxObservations; index++) {
    for (const result of results) {
      const observation = result.observations[index];
      if (!observation || seenUrls.has(observation.url)) continue;
      seenUrls.add(observation.url);
      observations.push(observation);
      if (observations.length >= maxObservations) break;
    }
  }
  return observations;
}

async function broadSocialMarketDiscovery(input: {
  geo: string;
  limit: number;
  platforms: SocialMarketPlatform[];
  researchGoal: MarketResearchGoal;
}): Promise<BroadMarketDiscovery> {
  const genericQueries = input.geo === 'JP'
    ? [...GENERIC_MARKET_DISCOVERY_QUERIES_JA]
    : [...GENERIC_MARKET_DISCOVERY_QUERIES_EN];
  const results: SocialContentResearchResult[] = [];
  const warnings: string[] = [];

  // Keep these searches serial. Each seed fans out to multiple site-restricted
  // SERP calls that share the same quota/cache ledger.
  for (const discoveryQuery of genericQueries) {
    try {
      results.push(await socialContentResearch({
        query: discoveryQuery,
        geo: input.geo,
        limit: Math.min(input.limit, 5),
        platforms: input.platforms
      }));
    } catch (error) {
      warnings.push('Generic social discovery failed for "' + discoveryQuery + '": ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  const observations = mergeBroadDiscoveryObservations(results, 30);
  const mergedSocial: SocialContentResearchResult = {
    source: 'serp_indexed_social_content',
    evidenceScope: 'public_index_plus_best_effort_public_page_metrics',
    query: null,
    platformsRequested: input.platforms,
    platformsObserved: input.platforms.filter(platform => observations.some(item => item.platform === platform)),
    observations,
    formatSummary: results.flatMap(result => result.formatSummary)
      .reduce<SocialContentResearchResult['formatSummary']>((acc, item) => {
        const existing = acc.find(entry => entry.format === item.format);
        if (!existing) {
          acc.push({
            format: item.format,
            count: item.count,
            platforms: [...item.platforms],
            evidence: [...item.evidence].slice(0, 5)
          });
        } else {
          existing.count += item.count;
          existing.platforms = [...new Set([...existing.platforms, ...item.platforms])];
          existing.evidence = [...existing.evidence, ...item.evidence]
            .filter((evidence, index, all) => all.findIndex(other => other.url === evidence.url) === index)
            .slice(0, 5);
        }
        return acc;
      }, [])
      .sort((left, right) => right.count - left.count || right.platforms.length - left.platforms.length || left.format.localeCompare(right.format)),
    platformStatus: results.flatMap(result => result.platformStatus),
    warnings: [...new Set([...warnings, ...results.flatMap(result => result.warnings)])],
    guidance: [
      'These observations were retrieved through multiple category-agnostic discovery lenses spanning first attempts, emerging interests, solo behavior, problems/workarounds, quitting/substitution, and purchases.',
      'Cluster ordering reflects evidence breadth and repetition only; it is not an opportunity score or market recommendation.',
      'A discovered cluster must be re-rooted into an explicit query and pass its own coverage gate before it can support a market conclusion.'
    ]
  };

  const clusters = clusterObservedSocialMarkets(observations).slice(0, 20);
  const validationClusters = selectBroadValidationClusters(clusters, genericQueries, 3);
  const validatedCandidates: ValidatedMarketCandidate[] = [];

  if (input.researchGoal === 'social_affiliate') {
    for (const cluster of validationClusters) {
      const validationQuery = rerootDiscoveredMarketQuery(cluster.label, input.geo);
      try {
        const packet = await marketIntelligenceResearch({
          query: validationQuery,
          geo: input.geo,
          limit: Math.min(input.limit, 5),
          includeTopAds: false,
          includePinterest: false,
          includeAppStore: false,
          includeSocialContent: true,
          socialPlatforms: input.platforms,
          researchGoal: 'social_affiliate'
        });
        validatedCandidates.push({
          clusterLabel: cluster.label,
          query: validationQuery,
          discoveryEvidenceCount: cluster.evidenceCount,
          discoveryContextualEvidenceCount: cluster.contextualEvidenceCount,
          discoveryPlatforms: cluster.platforms,
          coverage: packet.coverage,
          searchDemand: packet.queryFocus.searchDemand.results.slice(0, 6),
          searchSurface: {
            relatedSearches: packet.queryFocus.searchSurface.relatedSearches.slice(0, 8),
            peopleAlsoAsk: packet.queryFocus.searchSurface.peopleAlsoAsk.slice(0, 5),
            topResults: packet.queryFocus.searchSurface.topResults.slice(0, 5)
          },
          socialContent: {
            observations: packet.socialContent.observations.slice(0, 8),
            formatSummary: packet.socialContent.formatSummary.slice(0, 8)
          }
        });
      } catch (error) {
        warnings.push('Validation failed for discovered cluster "' + cluster.label + '": ' + (error instanceof Error ? error.message : String(error)));
      }
    }
  }

  const status: BroadMarketDiscovery['status'] = observations.length === 0
    ? 'unavailable'
    : clusters.length === 0
      ? 'partial'
      : 'available';

  return {
    mode: 'generic_social_to_validated_clusters',
    status,
    genericQueries,
    socialContent: mergedSocial,
    clusters,
    validatedCandidates,
    warnings: [...new Set([...warnings, ...mergedSocial.warnings])],
    guidance: [
      'Broad market labels require at least one contextual title/snippet phrase before query re-rooting; hashtags can support an anchored label but cannot create a market cluster by themselves.',
      'Validation slots are selected from at most one representative per discovery lens and ranked only by observed evidence breadth; weak lenses are allowed to contribute no candidate, and category names such as AI, gadgets, or skincare receive no lexical preference.',
      'Only validatedCandidates whose coverage.conclusionAllowed is true may be ranked or recommended for social-affiliate research.',
      'Affiliate program availability, payout, approval rules, social-media permissions, and conversion terms remain a separate monetization layer.'
    ]
  };
}

function signalFact(observation: MarketSignalObservation): string {
  const metrics = Object.entries(observation.metrics)
    .filter(([, value]) => value !== null && value !== '')
    .slice(0, 3)
    .map(([key, value]) => key + '=' + String(value))
    .join(', ');
  return metrics ? observation.label + ' (' + metrics + ')' : observation.label;
}

function buildThesisFrame(
  signals: MarketSignalScanResult,
  queryFocus: QueryFocusResearch,
  socialContent: SocialContentResearchResult,
  coverage: MarketEvidenceCoverage,
  mechanics: MarketingMechanicEvidence[],
  commercialization: Awaited<ReturnType<typeof appStoreResearch>>,
  marketDiscovery: BroadMarketDiscovery,
  supplementalWarnings: string[]
): MarketIntelligencePacket['thesisFrame'] {
  const evidenceBySignal: Record<string, Array<{ source: string; label: string; fact: string; url: string | null }>> = {};
  for (const result of signals.results) {
    for (const observation of result.observations.slice(0, 8)) {
      if (queryFocus.mode === 'hypothesis_led' && queryFocus.query) {
        const classification = classifyMarketIntent(observation.label, queryFocus.query);
        const role = intentRole(classification.primaryIntent, queryFocus.intentTree.targetIntents);
        if (role === 'adjacent_market' || role === 'out_of_scope') continue;
        const keyPrefix = role === 'contextual' ? 'query_context_external_' : '';
        for (const kind of result.signalKind) {
          const key = keyPrefix + kind;
          const list = evidenceBySignal[key] ?? [];
          list.push({ source: result.source, label: observation.label, fact: signalFact(observation), url: observation.url });
          evidenceBySignal[key] = list.slice(0, 12);
        }
        continue;
      }
      for (const kind of result.signalKind) {
        const list = evidenceBySignal[kind] ?? [];
        list.push({ source: result.source, label: observation.label, fact: signalFact(observation), url: observation.url });
        evidenceBySignal[kind] = list.slice(0, 12);
      }
    }
  }
  if (queryFocus.mode === 'hypothesis_led') {
    const primaryKeywordSet = new Set(queryFocus.intentTree.primaryEvidenceKeywords.map(value => value.normalize('NFKC').trim().toLowerCase()));
    const demandEvidence = queryFocus.searchDemand.results
      .filter(item => primaryKeywordSet.has(item.keyword.normalize('NFKC').trim().toLowerCase()))
      .filter(item => item.avgMonthlySearches !== null || item.averageCpcMicros !== null)
      .slice(0, 10)
      .map(item => ({
        source: 'google_ads',
        label: item.keyword,
        fact: item.keyword + ' (avgMonthlySearches=' + String(item.avgMonthlySearches ?? 'n/a') + ', averageCpcMicros=' + String(item.averageCpcMicros ?? 'n/a') + ', competitionIndex=' + String(item.competitionIndex ?? 'n/a') + ')',
        url: null
      }));
    if (demandEvidence.length) evidenceBySignal.query_search_demand = demandEvidence;

    const primaryBranches = queryFocus.intentTree.branches.filter(branch => branch.role === 'primary');
    const contextualBranches = queryFocus.intentTree.branches.filter(branch => branch.role === 'contextual');

    const surfaceEvidence = [
      ...primaryBranches.flatMap(branch => branch.relatedSearches).slice(0, 6).map(label => ({
        source: 'serp_related_searches',
        label,
        fact: 'Primary-intent related search for query "' + String(queryFocus.query) + '": ' + label,
        url: null
      })),
      ...primaryBranches.flatMap(branch => branch.peopleAlsoAsk).slice(0, 4).map(label => ({
        source: 'serp_people_also_ask',
        label,
        fact: 'Primary-intent People-also-ask question for query "' + String(queryFocus.query) + '": ' + label,
        url: null
      }))
    ];
    if (surfaceEvidence.length) evidenceBySignal.query_search_surface = surfaceEvidence;

    const contextEvidence = [
      ...contextualBranches.flatMap(branch => branch.relatedSearches).slice(0, 4).map(label => ({
        source: 'serp_context',
        label,
        fact: 'Context-only related search for query "' + String(queryFocus.query) + '": ' + label,
        url: null
      })),
      ...contextualBranches.flatMap(branch => branch.peopleAlsoAsk).slice(0, 3).map(label => ({
        source: 'serp_context',
        label,
        fact: 'Context-only People-also-ask question for query "' + String(queryFocus.query) + '": ' + label,
        url: null
      }))
    ];
    if (contextEvidence.length) evidenceBySignal.query_context_surface = contextEvidence;
  }

  if (socialContent.observations.length) {
    evidenceBySignal.query_social_content = socialContent.observations.slice(0, 12).map(item => ({
      source: item.platform,
      label: item.title,
      fact: [
        item.title,
        item.formatSignals.length ? 'formats=' + item.formatSignals.join(',') : null,
        item.metrics.views !== null ? 'views=' + String(item.metrics.views) : null,
        item.metrics.likes !== null ? 'likes=' + String(item.metrics.likes) : null
      ].filter(Boolean).join(' | '),
      url: item.url
    }));
  }

  const validatedDiscovery = marketDiscovery.validatedCandidates.filter(candidate => candidate.coverage.conclusionAllowed);
  if (validatedDiscovery.length) {
    evidenceBySignal.discovered_market_candidates = validatedDiscovery.slice(0, 6).map(candidate => ({
      source: 'generic_social_discovery',
      label: candidate.clusterLabel,
      fact: 'Observed cluster "' + candidate.clusterLabel + '" was re-rooted as "' + candidate.query + '" and passed social-affiliate coverage with discoveryEvidenceCount=' + String(candidate.discoveryEvidenceCount) + '.',
      url: candidate.socialContent.observations[0]?.url ?? null
    }));
  }

  const commercializationFacts: string[] = [];
  if (commercialization.query && commercialization.applicability === 'relevant') {
    commercializationFacts.push(
      'App Store lexical search query "' + commercialization.query + '" returned ' + String(commercialization.totalCount ?? commercialization.observations.length) + ' results; semantic/category fit must be checked from titles/descriptions before treating them as the same market.'
    );
    if (commercialization.metrics.observedAppCount) {
      commercializationFacts.push(
        String(commercialization.metrics.paidAppCount) + '/' + String(commercialization.metrics.observedAppCount) + ' observed apps are paid upfront.'
      );
      if (commercialization.metrics.medianRatingCount !== null) {
        commercializationFacts.push('Median observed rating count: ' + String(Math.round(commercialization.metrics.medianRatingCount)) + '.');
      }
    }
  } else if (commercialization.query && commercialization.applicability === 'not_applicable') {
    commercializationFacts.push('App Store commercialization was not treated as applicable to this explicit query intent.');
  }
  const contradictionsAndUnknowns = [
    'Attention/search/ad metrics do not prove willingness to pay or unit sales.',
    ...(commercialization.query && commercialization.applicability === 'relevant' && commercialization.observations.length === 0 ? ['No App Store commercialization evidence was retrieved for the supplied query.'] : []),
    ...(mechanics.length === 0 ? ['No reliable creative mechanic was extracted from the currently public Top Ads surface.'] : []),
    ...(mechanics.length ? ['TikTok Top Ads mechanics are cross-category creative references, not evidence that the supplied query itself has demand.'] : []),
    ...(commercialization.applicability === 'relevant' ? ['App Store evidence is lexical-search evidence only; same words can describe a different semantic category or direction of use. Review descriptionExcerpt before using it as commercialization support.'] : []),
    ...(queryFocus.intentTree.mixedIntent ? ['The query surface contains multiple search intents. Do not aggregate them into one market thesis; use the intent tree.'] : []),
    ...(queryFocus.intentTree.senseSelectionRequired ? ['The root query is semantically/intent-wise underspecified. This packet is discovery evidence only: select a sense and re-root with an intent-bearing query before writing the market thesis.'] : []),
    ...coverage.missingRequired.map(item => 'Required evidence is missing: ' + item + '.'),
    ...socialContent.warnings.slice(0, 5),
    ...queryFocus.searchSurface.warnings,
    ...queryFocus.searchDemand.warnings,
    ...supplementalWarnings.slice(0, 5)
  ];
  return {
    evidenceBySignal,
    strongestMechanics: mechanics.slice(0, 8).map(item => ({ mechanic: item.mechanic, count: item.count })),
    commercializationFacts,
    contradictionsAndUnknowns: [...new Set(contradictionsAndUnknowns)],
    requiredAgentOutput: [
      coverage.conclusionAllowed
        ? 'Write 1-3 market theses only after reading the evidence above.'
        : 'Do not finalize, rank, or recommend markets from this packet because required evidence coverage is insufficient.',
      'For each thesis, cite at least two independent observed sources when available.',
      'Read coverage before making any recommendation. An unavailable source is missing evidence, not evidence of zero demand or zero social activity.',
      ...(queryFocus.mode === 'hypothesis_led' ? [
        'Declare which intent branch the thesis is about before interpreting demand.',
        ...(queryFocus.intentTree.senseSelectionRequired ? ['Do not finalize a thesis from this ambiguous-root packet. Select one semantic sense/intent and re-run market_intelligence_research with a more explicit query; then reject evidence that uses the phrase in a different sense.'] : []),
        'Treat query_search_demand, query_search_surface, query-relevant Hacker News, and commercialization evidence as primary only when they belong to the selected intent branch.',
        'Do not aggregate company/entity, investment, career/qualification, or other adjacent branches into the main market thesis. They may become separate theses only after independently re-rooting and validating them.',
        'Context-only evidence may explain the market but must not establish demand by itself. Do not use unrelated broad trend headlines as support for the supplied query.'
      ] : [
        'Use marketDiscovery.clusters as observed discovery hypotheses, not recommendations.',
        'For social-affiliate research, rank or recommend only marketDiscovery.validatedCandidates whose coverage.conclusionAllowed is true. Do not invent additional candidate markets from model priors.'
      ]),
      'State the underlying behavior/desire, its current fulfillment, and the marketing mechanic that appears to trigger attention.',
      'Treat Top Ads mechanics as transferable creative hypotheses only; never use them as proof of demand for the selected intent branch.',
      'Propose adjacency dimensions (audience, format, context, social loop, output artifact, distribution, business model) before proposing products.',
      'Classify each resulting concept as copy_like, adjacent, or speculative and explain why.',
      'State disconfirming evidence, payment unknowns, and the next cheapest validation step. Do not invent missing market pain.'
    ]
  };
}

export async function marketIntelligenceResearch(input: unknown = {}): Promise<MarketIntelligencePacket> {
  const args = z.object(marketIntelligenceResearchShape).strict().parse(input);
  const geo = (args.geo ?? 'JP').toUpperCase();
  const limit = args.limit ?? 10;
  const query = args.query?.trim() || null;
  const includeTopAds = args.includeTopAds ?? true;
  const includePinterest = args.includePinterest ?? true;
  const includeAppStore = args.includeAppStore ?? true;
  const includeSocialContent = args.includeSocialContent ?? Boolean(query);
  const socialPlatforms = (args.socialPlatforms?.length ? args.socialPlatforms : [...DEFAULT_SOCIAL_MARKET_PLATFORMS]) as SocialMarketPlatform[];
  const researchGoal = (args.researchGoal ?? 'general') as MarketResearchGoal;

  // Run the primary query surface first. Both primary SERP research and social
  // discovery use the shared quota/cache ledger, so serializing this first stage
  // avoids self-contention in Firestore and reduces upstream search bursts.
  const queryFocus = await queryFocusedResearch(query, geo, limit);

  const [signals, socialContentResult, topAdsResult, pinterestResult, appStoreResult] = await Promise.all([
    marketSignalScan({
      sources: query ? ['hacker_news'] : [...MARKET_SENSOR_SOURCE_IDS],
      query: query ?? undefined,
      geo,
      limit,
      tiktokPeriodDays: args.tiktokPeriodDays,
      hackerNewsFeed: args.hackerNewsFeed
    }),
    includeSocialContent
      ? socialContentResearch({ query, geo, limit, platforms: socialPlatforms })
      : Promise.resolve({
          source: 'serp_indexed_social_content' as const,
          evidenceScope: 'public_index_plus_best_effort_public_page_metrics' as const,
          query,
          platformsRequested: socialPlatforms,
          platformsObserved: [] as SocialMarketPlatform[],
          observations: [],
          formatSummary: [],
          platformStatus: [],
          warnings: ['Query-relevant social-content research was disabled for this research call.'],
          guidance: ['Disabled social research is missing evidence, not evidence that the platforms have no relevant content.']
        }),
    includeTopAds ? tiktokTopAds(geo, Math.min(limit, 10)) : Promise.resolve({ url: '', observations: [] as TopAdObservation[], warnings: ['TikTok Top Ads was disabled for this research call.'] }),
    includePinterest ? pinterestTrends(query, geo, limit) : Promise.resolve({ source: 'pinterest_trends' as const, url: '', observations: [] as PinterestObservation[], warnings: ['Pinterest Trends was disabled for this research call.'] }),
    includeAppStore && appStoreRelevantForQuery(query) ? appStoreResearch(query, geo, limit) : Promise.resolve({
      source: 'app_store' as const,
      evidenceScope: 'lexical_search_only' as const,
      applicability: 'not_applicable' as const,
      query,
      url: null,
      totalCount: null,
      observations: [] as AppStoreObservation[],
      metrics: { observedAppCount: 0, paidAppCount: 0, medianPrice: null, medianRatingCount: null, medianRating: null },
      warnings: [includeAppStore
        ? 'App Store commercialization was skipped because the explicit query intent is not product/app oriented.'
        : 'App Store commercialization check was disabled for this research call.']
    })
  ]);

  const resolvedQueryFocus = attachQuerySignalsToIntentTree(queryFocus, signals);
  const marketDiscovery = query
    ? emptyBroadMarketDiscovery(socialPlatforms)
    : await broadSocialMarketDiscovery({ geo, limit, platforms: socialPlatforms, researchGoal });
  const creativeCenterSocialCount = signals.results
    .filter(result => result.source === 'tiktok_creative_center')
    .reduce((sum, result) => sum + result.observations.length, 0);
  const discoveredSocialMetricCount = marketDiscovery.socialContent.observations
    .filter(item => Object.values(item.metrics).some(value => value !== null))
    .length;
  const broadSocialSources = [
    ...(creativeCenterSocialCount > 0 ? ['tiktok_creative_center'] : []),
    ...marketDiscovery.socialContent.platformsObserved
  ];
  const broadSocialMetricSources = [
    ...(creativeCenterSocialCount > 0 ? ['tiktok_creative_center'] : []),
    ...marketDiscovery.socialContent.observations
      .filter(item => Object.values(item.metrics).some(value => value !== null))
      .map(item => item.metricProvenance)
      .filter(source => source !== 'none')
  ];
  const coverage = assessMarketEvidenceCoverage({
    researchGoal,
    query,
    broadSignalCount: signals.results.reduce((sum, result) => sum + result.observations.length, 0) + marketDiscovery.socialContent.observations.length,
    broadSourceCount: signals.sourcesSucceeded.length,
    broadSocialSignalCount: creativeCenterSocialCount + marketDiscovery.socialContent.observations.length,
    broadSocialMetricCount: creativeCenterSocialCount + discoveredSocialMetricCount,
    broadSocialSources,
    broadSocialMetricSources,
    searchSurfaceCount:
      resolvedQueryFocus.searchSurface.relatedSearches.length +
      resolvedQueryFocus.searchSurface.peopleAlsoAsk.length +
      resolvedQueryFocus.searchSurface.topResults.length,
    searchDemandCount: resolvedQueryFocus.searchDemand.results.length,
    socialContent: socialContentResult,
    senseSelectionRequired: resolvedQueryFocus.intentTree.senseSelectionRequired
  });
  const mechanics = mechanicsSummary(topAdsResult.observations);
  const warnings = [
    ...signals.warnings,
    ...(query ? socialContentResult.warnings : []),
    ...marketDiscovery.warnings,
    ...resolvedQueryFocus.searchSurface.warnings,
    ...resolvedQueryFocus.searchDemand.warnings,
    ...topAdsResult.warnings,
    ...pinterestResult.warnings,
    ...appStoreResult.warnings
  ];

  return {
    fetchedAt: new Date().toISOString(),
    query,
    geo,
    signals,
    queryFocus: resolvedQueryFocus,
    socialContent: socialContentResult,
    coverage,
    marketDiscovery,
    creativeEvidence: {
      source: 'tiktok_top_ads',
      scope: 'cross_category_reference',
      url: topAdsResult.url,
      observations: topAdsResult.observations,
      mechanics,
      warnings: topAdsResult.warnings
    },
    pinterest: pinterestResult,
    commercialization: appStoreResult,
    thesisFrame: buildThesisFrame(signals, resolvedQueryFocus, socialContentResult, coverage, mechanics, appStoreResult, marketDiscovery, warnings),
    warnings
  };
}

interface SnapshotDocument {
  id: string;
  label: string;
  query: string | null;
  geo: string;
  createdAt: string;
  packet: MarketIntelligencePacket;
}

function parseDoc<T>(doc: any): T {
  return { id: String(doc.name ?? '').split('/').pop() ?? '', ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)])) } as T;
}

async function readSnapshot(idValue: string): Promise<SnapshotDocument> {
  try {
    const doc = await firestore('/marketSignalSnapshots/' + snapshotId.parse(idValue));
    return parseDoc<SnapshotDocument>(doc);
  } catch (error) {
    if (error instanceof FirestoreError && error.status === 404) throw new Error('Market signal snapshot not found: ' + idValue);
    throw error;
  }
}

export async function marketSignalSnapshotSave(input: unknown) {
  const args = z.object(marketSignalSnapshotSaveShape).strict().parse(input);
  const packet = await marketIntelligenceResearch({
    query: args.query,
    geo: args.geo,
    limit: args.limit,
    tiktokPeriodDays: args.tiktokPeriodDays,
    hackerNewsFeed: args.hackerNewsFeed,
    includeTopAds: args.includeTopAds,
    includePinterest: args.includePinterest,
    includeAppStore: args.includeAppStore,
    includeSocialContent: args.includeSocialContent,
    socialPlatforms: args.socialPlatforms,
    researchGoal: args.researchGoal
  });
  const idValue = args.id ?? ('market-' + Date.now().toString(36) + '-' + randomUUID().slice(0, 8));
  const createdAt = new Date().toISOString();
  const doc: SnapshotDocument = {
    id: idValue,
    label: args.label ?? [packet.query, packet.geo, createdAt.slice(0, 10)].filter(Boolean).join(' / '),
    query: packet.query,
    geo: packet.geo,
    createdAt,
    packet
  };
  if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > 850000) throw new Error('Market snapshot exceeds Firestore document budget; reduce limit or sources.');
  const runId = randomUUID();
  await firestore(':commit', {
    method: 'POST',
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: firestoreDocumentName('marketSignalSnapshots/' + idValue),
            fields: Object.fromEntries(Object.entries(doc).map(([key, item]) => [key, field(item)]))
          },
          currentDocument: { exists: false }
        },
        {
          update: {
            name: firestoreDocumentName('runs/' + runId),
            fields: Object.fromEntries(Object.entries({
              id: runId,
              command: 'market_signal_snapshot_save',
              targetId: idValue,
              actor: 'remote_mcp',
              createdAt,
              outcome: 'succeeded'
            }).map(([key, item]) => [key, field(item)]))
          },
          currentDocument: { exists: false }
        }
      ]
    })
  });
  return { id: idValue, label: doc.label, query: doc.query, geo: doc.geo, createdAt, runId, packet };
}

interface FlatObservation {
  source: string;
  key: string;
  label: string;
  metrics: Record<string, number | string | boolean | null>;
}

function flattenPacket(packet: MarketIntelligencePacket): FlatObservation[] {
  const items: FlatObservation[] = [];
  for (const result of packet.signals.results) {
    for (const observation of result.observations) {
      items.push({
        source: result.source,
        key: normalizeKey(observation.label),
        label: observation.label,
        metrics: observation.metrics
      });
    }
  }
  for (const item of packet.queryFocus?.searchDemand?.results ?? []) {
    items.push({
      source: 'google_ads_query_demand',
      key: normalizeKey(item.keyword),
      label: item.keyword,
      metrics: {
        avgMonthlySearches: item.avgMonthlySearches,
        averageCpcMicros: item.averageCpcMicros,
        competitionIndex: item.competitionIndex
      }
    });
  }
  for (const observation of packet.socialContent?.observations ?? []) {
    items.push({
      source: 'social_' + observation.platform,
      key: normalizeKey(observation.url),
      label: observation.title,
      metrics: {
        views: observation.metrics.views,
        likes: observation.metrics.likes,
        comments: observation.metrics.comments,
        shares: observation.metrics.shares
      }
    });
  }
  for (const observation of packet.creativeEvidence.observations) {
    items.push({
      source: 'tiktok_top_ads',
      key: observation.key,
      label: observation.label,
      metrics: { likes: observation.likes, ctrTopPercent: observation.ctrTopPercent, budget: observation.budget }
    });
  }
  for (const observation of packet.pinterest.observations) {
    items.push({ source: 'pinterest_trends', key: observation.key, label: observation.label, metrics: observation.metrics });
  }
  for (const observation of packet.commercialization.observations) {
    items.push({
      source: 'app_store',
      key: observation.key,
      label: observation.label,
      metrics: { price: observation.price, rating: observation.rating, ratingCount: observation.ratingCount }
    });
  }
  return items;
}

export function compareMarketPackets(left: MarketIntelligencePacket, right: MarketIntelligencePacket) {
  const leftMap = new Map(flattenPacket(left).map(item => [item.source + ':' + item.key, item]));
  const rightMap = new Map(flattenPacket(right).map(item => [item.source + ':' + item.key, item]));
  const added: FlatObservation[] = [];
  const removed: FlatObservation[] = [];
  const matched: Array<{
    source: string;
    key: string;
    label: string;
    metricDeltas: Array<{ metric: string; before: number; after: number; delta: number; relativeDelta: number | null }>;
  }> = [];

  for (const [key, rightItem] of rightMap) {
    const leftItem = leftMap.get(key);
    if (!leftItem) {
      added.push(rightItem);
      continue;
    }
    const metricDeltas: Array<{ metric: string; before: number; after: number; delta: number; relativeDelta: number | null }> = [];
    for (const metric of new Set([...Object.keys(leftItem.metrics), ...Object.keys(rightItem.metrics)])) {
      const before = leftItem.metrics[metric];
      const after = rightItem.metrics[metric];
      if (typeof before !== 'number' || typeof after !== 'number' || !Number.isFinite(before) || !Number.isFinite(after) || before === after) continue;
      metricDeltas.push({
        metric,
        before,
        after,
        delta: after - before,
        relativeDelta: before === 0 ? null : (after - before) / Math.abs(before)
      });
    }
    matched.push({ source: rightItem.source, key: rightItem.key, label: rightItem.label, metricDeltas });
  }
  for (const [key, leftItem] of leftMap) {
    if (!rightMap.has(key)) removed.push(leftItem);
  }

  const velocityHighlights = matched
    .flatMap(item => item.metricDeltas.map(delta => ({ ...delta, source: item.source, key: item.key, label: item.label })))
    .sort((left, right) => Math.abs(right.relativeDelta ?? 0) - Math.abs(left.relativeDelta ?? 0) || Math.abs(right.delta) - Math.abs(left.delta))
    .slice(0, 30);

  const sourceSummary: Record<string, { added: number; removed: number; matched: number; changed: number }> = {};
  for (const source of new Set([...leftMap.values(), ...rightMap.values()].map(item => item.source))) {
    sourceSummary[source] = {
      added: added.filter(item => item.source === source).length,
      removed: removed.filter(item => item.source === source).length,
      matched: matched.filter(item => item.source === source).length,
      changed: matched.filter(item => item.source === source && item.metricDeltas.length > 0).length
    };
  }

  return {
    leftFetchedAt: left.fetchedAt,
    rightFetchedAt: right.fetchedAt,
    queryChanged: left.query !== right.query,
    geoChanged: left.geo !== right.geo,
    sourceSummary,
    added: added.slice(0, 50),
    removed: removed.slice(0, 50),
    velocityHighlights,
    guidance: [
      'An entry appearing or disappearing from a ranked/trending surface is a rank-set change, not proof of demand growth or collapse.',
      'Relative deltas are meaningful only for comparable numeric metrics from the same source and label.',
      'Use velocity as a trigger for deeper validation, not as an automatic product decision.'
    ]
  };
}

export async function marketSignalSnapshotCompare(input: unknown) {
  const args = z.object(marketSignalSnapshotCompareShape).strict().parse(input);
  const left = await readSnapshot(args.snapshotId);
  if (args.rightSnapshotId) {
    const right = await readSnapshot(args.rightSnapshotId);
    return {
      baseline: { id: left.id, label: left.label, createdAt: left.createdAt, query: left.query, geo: left.geo },
      comparison: { id: right.id, label: right.label, createdAt: right.createdAt, query: right.query, geo: right.geo },
      delta: compareMarketPackets(left.packet, right.packet)
    };
  }

  const current = await marketIntelligenceResearch({
    query: args.query ?? left.query ?? undefined,
    geo: args.geo ?? left.geo,
    limit: args.limit,
    tiktokPeriodDays: args.tiktokPeriodDays,
    hackerNewsFeed: args.hackerNewsFeed,
    includeTopAds: args.includeTopAds,
    includePinterest: args.includePinterest,
    includeAppStore: args.includeAppStore,
    includeSocialContent: args.includeSocialContent,
    socialPlatforms: args.socialPlatforms,
    researchGoal: args.researchGoal
  });
  return {
    baseline: { id: left.id, label: left.label, createdAt: left.createdAt, query: left.query, geo: left.geo },
    comparison: { id: null, label: 'live', createdAt: current.fetchedAt, query: current.query, geo: current.geo },
    current,
    delta: compareMarketPackets(left.packet, current)
  };
}
