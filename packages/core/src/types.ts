export type Intent = 'info' | 'trans' | 'local' | 'mixed';

export interface ProjectSettings {
  ads: {
    locationIds: number[];
    languageId: number;
  };
  pipeline: {
    staleDays: number;
    limits: {
      nodesPerRun: number;
      ideasPerNode: number;
      groupsOutlinePerRun: number;
    };
  };
  weights: {
    volume: number;
    competition: number;
    intent: number;
    novelty: number;
  };
  thresholds: {
    minVolume: number;
    maxCompetition: number;
  };
  links: {
    maxPerGroup: number;
  };
}

export interface ProjectDoc {
  name: string;
  domain?: string;
  settings: ProjectSettings;
  halt?: boolean;
}

export interface ThemeDoc {
  name: string;
  autoUpdate: boolean;
  settings?: Partial<ProjectSettings>;
}

export type TopicStatus = 'seeded' | 'ready' | 'frozen';

export interface TopicDoc {
  title: string;
  status: TopicStatus;
  updatedAt: string;
}

export type NodeStatus = 'ready' | 'ideas-pending' | 'ideas-done';

export interface NodeDoc {
  title: string;
  themeId: string;
  depth: number;
  intent: Intent;
  lastIdeasAt?: string;
  status: NodeStatus;
  updatedAt: string;
}

export interface KeywordMetrics {
  avgMonthly?: number;
  competition?: number;
  cpcMicros?: number;
}

export type KeywordStatus = 'new' | 'scored' | 'grouped';

export interface KeywordDoc {
  text: string;
  dedupeHash: string;
  locale: 'ja';
  sourceNodeId: string;
  metrics: KeywordMetrics;
  score: number;
  groupId?: string;
  status: KeywordStatus;
  versions: Array<{ metrics: KeywordMetrics; score: number; at: string }>;
  updatedAt: string;
}

export interface GroupSummary {
  outlineTitle: string;
  h2: string[];
  h3?: string[];
  faq?: Array<{ q: string; a: string }>;
}

export interface GroupDoc {
  title: string;
  keywords: string[];
  intent: Intent;
  summary?: GroupSummary;
  priorityScore: number;
  clusterStats: {
    size: number;
    topKw?: string;
  };
  updatedAt: string;
}

export type LinkReason = 'hierarchy' | 'sibling' | 'hub';

export interface LinkDoc {
  fromGroupId: string;
  toGroupId: string;
  reason: LinkReason;
  weight: number;
  updatedAt: string;
}

export type JobType = 'daily' | 'manual';

export type JobStatus = 'running' | 'succeeded' | 'failed' | 'skipped';

export interface JobSummaryError {
  type: string;
  count: number;
}

export interface JobSummary {
  nodesProcessed: number;
  newKeywords: number;
  groupsCreated: number;
  groupsUpdated: number;
  outlinesCreated: number;
  linksUpdated: number;
  errors: JobSummaryError[];
}

export interface JobDoc {
  type: JobType;
  status: JobStatus;
  payload: {
    projectId: string;
    themeIds?: string[];
  };
  summary: JobSummary;
  startedAt: string;
  finishedAt: string;
}
