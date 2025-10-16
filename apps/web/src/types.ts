export type Intent = "info" | "trans" | "local" | "mixed";

export interface ProjectSummary {
  id: string;
  name: string;
  domain?: string;
  halt?: boolean;
  lastJob?: {
    status: "succeeded" | "failed" | "running" | "skipped";
    finishedAt: string;
    nodesProcessed: number;
    outlinesCreated: number;
  };
  settings: ProjectSettings;
}

export interface ThemeSummary {
  id: string;
  name: string;
  autoUpdate: boolean;
  pendingNodes: number;
  lastUpdatedAt: string;
  settings?: Partial<ProjectSettings>;
  nodes?: NodeDocWithId[];
}

export interface KeywordMetrics {
  avgMonthly?: number;
  competition?: number;
  cpcMicros?: number;
}

export interface GroupSummary {
  id: string;
  title: string;
  intent: Intent;
  priorityScore: number;
  outline?: {
    outlineTitle: string;
    h2: string[];
    h3?: string[];
    faq?: Array<{ q: string; a: string }>;
  };
  keywords: Array<{ id: string; text: string; metrics: KeywordMetrics }>;
  links: Array<{ targetId: string; reason: "hierarchy" | "sibling" | "hub"; weight: number }>;
}

export interface JobHistoryItem {
  id: string;
  type: "daily" | "manual";
  status: "running" | "succeeded" | "failed" | "skipped";
  startedAt: string;
  finishedAt: string;
  summary: {
    nodesProcessed: number;
    newKeywords: number;
    groupsCreated: number;
    groupsUpdated: number;
    outlinesCreated: number;
    linksUpdated: number;
  };
}

export interface ProjectSettings {
  pipeline: {
    staleDays: number;
    limits: {
      nodesPerRun: number;
      ideasPerNode: number;
      groupsOutlinePerRun: number;
    };
  };
  thresholds: {
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
}

export interface NodeDocWithId {
  id: string;
  title: string;
  themeId: string;
  depth: number;
  intent: Intent;
  lastIdeasAt?: string;
  status: "ready" | "ideas-pending" | "ideas-done";
  updatedAt: string;
}
