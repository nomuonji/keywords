export type Intent = 'info' | 'trans' | 'local' | 'mixed';

export interface WordpressConfig {
  platform: 'wordpress';
  url: string;
  username: string;
  password: string;
}

export interface HatenaConfig {
  platform: 'hatena';
  apiKey: string;
  blogId: string;
  hatenaId: string;
}

export type BlogMediaConfig = WordpressConfig | HatenaConfig;

export interface BlogMedia {
  post(article: string): Promise<string>;
  getUrl(postId: string): Promise<string>;
}

export interface ProjectSettings {
  name: string;
  pipeline: {
    staleDays: number;
    limits: {
      nodesPerRun: number;
      ideasPerNode: number;
      groupsOutlinePerRun: number;
      groupsBlogPerRun: number;
    };
  };
  ads: {
    locale: string;
    locationIds: number[];
    languageId: number;
    maxResults: number;
    minVolume: number;
    maxCompetition: number;
  };
  weights: {
    volume: number;
    competition: number;
    intent: number;
    novelty: number;
  };
  links: {
    maxPerGroup: number;
  };
  blog?: BlogMediaConfig;
  projectId: string;
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
  id: string;
  title: string;
  description: string;
  outlineTitle: string;
  h2: string[];
  h3?: Record<string, string[]>;
  faq?: Array<{ q: string; a: string }>;
  intent: Intent;
}

export interface GroupDoc {
  title: string;
  keywords: string[];
  intent: Intent;
  summary?: GroupSummary;
  priorityScore: number;
  postUrl?: string;
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
  postsCreated: number;
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

export type GroupDocWithId = GroupDoc & { id: string };
export type KeywordDocWithId = KeywordDoc & { id: string };
