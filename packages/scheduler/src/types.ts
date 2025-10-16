import type {
  GroupDoc,
  Intent,
  JobDoc,
  KeywordDoc,
  LinkDoc,
  NodeDoc,
  ProjectDoc,
  ProjectSettings,
  ThemeDoc
} from '@keywords/core';

export interface SchedulerOptions {
  projectId: string;
  themeIds?: string[];
  manual?: boolean;
}

export interface PipelineCounters {
  nodesProcessed: number;
  newKeywords: number;
  groupsCreated: number;
  groupsUpdated: number;
  outlinesCreated: number;
  linksUpdated: number;
}

export interface PipelineDependencies {
  firestore: FirebaseFirestore.Firestore;
  ads: {
    generateIdeas: (params: {
      node: NodeDoc;
      settings: ProjectSettings;
    }) => Promise<Array<{ keyword: string; metrics: KeywordDoc['metrics'] }>>;
  };
  gemini: {
    embed: (
      keywords: Array<{ id: string; text: string }>
    ) => Promise<Array<{ id: string; vector: number[] }>>;
    summarize: (params: {
      group: GroupDocWithId;
      keywords: KeywordDocWithId[];
      settings: ProjectSettings;
    }) => Promise<GroupDoc['summary']>;
    classifyIntent: (text: string) => Promise<Intent>;
  };
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
}

export interface NodeDocWithId extends NodeDoc {
  id: string;
}

export interface ThemeDocWithId extends ThemeDoc {
  id: string;
}

export interface KeywordDocWithId extends KeywordDoc {
  id: string;
}

export interface GroupDocWithId extends GroupDoc {
  id: string;
}

export interface LinkDocWithId extends LinkDoc {
  id: string;
}

export interface ProjectContext {
  projectId: string;
  project: ProjectDoc;
  settings: ProjectSettings;
  themes: ThemeDocWithId[];
}

export interface PipelineContext extends ProjectContext {
  options: SchedulerOptions;
  deps: PipelineDependencies;
  counters: PipelineCounters;
  jobRef: FirebaseFirestore.DocumentReference<JobDoc>;
}
