/** Firestore-backed state used by the remote Keywords Operator MCP. */
export type ResearchSessionStatus = 'active' | 'paused' | 'completed' | 'archived';

export type ThemeCandidateStatus = 'surviving' | 'challenged' | 'killed' | 'parked' | 'pilot_ready';

export type ThemeObservedFact = {
  label: string;
  value: string;
  source?: string;
  observedAt?: string;
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
};

export type ThemeCandidate = {
  id: string;
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
  challengeHistory: ThemeChallenge[];
  historyDigest: string;
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
  themeCandidates?: ThemeCandidate[];
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
