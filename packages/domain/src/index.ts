export type ActorType = 'human' | 'agent' | 'system';
export type KeywordStatus = 'active' | 'rejected';
export type ClusterStatus = 'active' | 'archived';
export type PageStatus = 'proposed' | 'approved' | 'archived';
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
