/** Firestore-backed state used by the remote Keywords Operator MCP. */
export type ResearchSessionStatus = 'active' | 'paused' | 'completed' | 'archived';

export type ThemeCandidateStatus = 'surviving' | 'challenged' | 'killed' | 'parked' | 'pilot_ready';

export type ThemeObservedFact = {
  label: string;
  value: string;
  source?: string;
  observedAt?: string;
};

export type ThemeDiscovery = {
  siteId?: string;
  audience: string;
  question: string;
  observations: Array<{ kind: 'question' | 'review' | 'gsc' | 'competitor' | 'other'; url: string; observedAt: string; excerpt: string }>;
  serpReviews: Array<{ query: string; provider: 'brave' | 'serper'; researchedAt: string; pages: Array<{
    url: string; readAt: string; excerpt: string; coverage: 'full' | 'partial'; answers: string; remainingGap: string;
  }> }>;
  unmetNeed: string;
  deliverable: string;
  feasibility: string;
  falsification: string;
  nextQueries: Array<{ query: string; reason: string }>;
};

export type ThemeChallenge = {
  id: string;
  createdAt: string;
  attack: string;
  evidence: string[];
  defense: string;
  conclusion: string;
  statusAfter: ThemeCandidateStatus;
  nextChallenge: string;
  discovery?: ThemeDiscovery | null;
};

export type ThemeCandidate = {
  id: string;
  sessionId: string;
  title: string;
  thesis: string;
  status: ThemeCandidateStatus;
  currentVerdict: string;
  whyStillAlive: string;
  fatalRisks: string[];
  unknowns: string[];
  observedFacts: ThemeObservedFact[];
  alternatives: string[];
  nextChallenge: string;
  discovery?: ThemeDiscovery | null;
  challengeHistory: ThemeChallenge[];
  historyDigest: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ResearchSession = {
  id: string;
  title: string;
  objective: string;
  seedThemes: string[];
  hypotheses: string[];
  researchedKeywordIds: string[];
  shortlistedKeywordIds: string[];
  rejectedKeywordIds: string[];
  findings: string[];
  nextActions: string[];
  siteConceptIds: string[];
  notes: string;
  status: ResearchSessionStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  themeLedgerVersion?: number;
};

export type SerpCacheEntry = {
  id: string;
  cacheKey: string;
  query: string;
  country: string | null;
  language: string | null;
  location: string | null;
  provider: 'brave' | 'serper';
  num: number;
  fetchedAt: string;
  expiresAt: string;
  snapshot: Record<string, unknown>;
  analysis: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type SerpUsage = {
  month: string;
  actualApiRequests: number;
  cacheHits: number;
  forcedApiRequests: number;
  blockedRequests: number;
  createdAt: string;
  updatedAt: string;
};


export type SeoSourceType = 'x_account' | 'website' | 'newsletter' | 'youtube' | 'other';
export type SeoSourceStatus = 'active' | 'paused' | 'archived';
export type SeoSourceOrigin = 'builtin' | 'firestore';

export type SeoSource = {
  id: string;
  sourceType: SeoSourceType;
  label: string;
  canonicalUrl: string;
  handle: string | null;
  topics: string[];
  whyWatch: string;
  trustNotes: string;
  notes: string;
  status: SeoSourceStatus;
  reviewCadenceDays: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  origin: SeoSourceOrigin;
};

export type SeoSourceFindingDisposition = 'candidate' | 'adopted' | 'rejected' | 'watch';
export type SeoSourceFindingConfidence = 'low' | 'low_to_medium' | 'medium' | 'medium_to_high' | 'high';
export type SeoSourceFinding = {
  url: string;
  publishedAt: string | null;
  claimSummary: string;
  relevance: string;
  disposition: SeoSourceFindingDisposition;
  confidence: SeoSourceFindingConfidence;
  verificationNeeded: boolean;
  evaluatorIds: string[];
  notes: string;
};

export type SeoSourceScanOutcome = 'useful' | 'mixed' | 'nothing_new' | 'needs_followup' | 'unavailable';
export type SeoSourceScan = {
  id: string;
  sourceId: string;
  reviewedAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  outcome: SeoSourceScanOutcome;
  summary: string;
  retrievalMethod: string;
  limitations: string[];
  findings: SeoSourceFinding[];
  actor: string;
  createdAt: string;
};
