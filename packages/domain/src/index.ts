export type ActorType = 'human' | 'agent' | 'system';
export type KeywordStatus = 'active' | 'rejected';
export type CandidateStatus = 'discovered' | 'shortlisted' | 'hold' | 'rejected' | 'research_more';
export type DiscoveryJobStatus = 'waiting_for_agent' | 'running' | 'awaiting_review' | 'blocked' | 'completed' | 'failed' | 'cancelled';
export type CapabilityStatus = 'not_configured' | 'checking' | 'available' | 'expired' | 'rate_limited' | 'failed';
export type ProjectMode = 'existing_site' | 'topic_only';
export type ClusterStatus = 'active' | 'archived';
export type PageStatus = 'proposed' | 'approved' | 'published' | 'archived' | 'stale';
export type TaskStatus = 'todo' | 'doing' | 'review' | 'done';
export type DecisionVerdict = 'approved' | 'rejected' | 'edited' | 'noted';
export type InsightStatus = 'open' | 'accepted' | 'dismissed';
export type WorkSessionStatus = 'running' | 'awaiting_review' | 'blocked' | 'completed' | 'cancelled';
export type WorkCheckpointState = 'working' | 'awaiting_review' | 'blocked' | 'completed';

export interface CommandContext {
  actor: ActorType;
  actorId?: string;
  projectId?: string;
  workSessionId?: string;
}

export interface ProjectBrief {
  id: string;
  name: string;
  domain: string | null;
  mode: ProjectMode;
  topic: string | null;
  audience: string | null;
  language: string;
  country: string;
  region: string | null;
  excludedTerms: string[];
  discoveryCadenceDays: number;
  discoveryMaxCandidates: number;
  discoveryMaxExternalRequests: number;
  lastDiscoveryAt: string | null;
}

export interface ProjectSnapshot {
  project: { id: string; name: string; domain: string | null };
  counts: {
    topics: number;
    keywords: number;
    unclusteredKeywords: number;
    clusters: number;
    proposedPages: number;
    openTasks: number;
    openInsights: number;
    openDiscoveryJobs?: number;
    candidatesToReview?: number;
  };
  recentRuns: Array<{
    id: string;
    actor: string;
    command: string;
    status: string;
    createdAt: string;
    durationMs: number | null;
  }>;
}
