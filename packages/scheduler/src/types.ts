import type {
  GroupDoc,
  Intent,
  JobDoc,
  KeywordDoc,
  LinkDoc,
  NodeDoc,
  ProjectDoc,
  ProjectSettings,
  ThemeDoc,
  GroupDocWithId,
  KeywordDocWithId
} from '@keywords/core';
import type { firestore as AdminFirestore } from 'firebase-admin';
import type { Logger } from 'pino';
import type { KeywordIdeaClient } from '@keywords/ads';
import type { GeminiClient } from '@keywords/gemini';
import type { EnvironmentConfig } from './config';

export interface SchedulerStagesOptions {
  ideas?: boolean;
  clustering?: boolean;
  scoring?: boolean;
  outline?: boolean;
  links?: boolean;
}

export interface SchedulerOptions {
  projectId: string;
  themeIds?: string[];
  manual?: boolean;
  stages?: SchedulerStagesOptions;
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
  ads: KeywordIdeaClient;
  gemini: GeminiClient;
  firestore: AdminFirestore.Firestore;
  logger: Logger;
}

export interface NodeDocWithId extends NodeDoc {
  id: string;
}

export interface ThemeDocWithId extends ThemeDoc {
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
  config: EnvironmentConfig;
  deps: PipelineDependencies;
  counters: PipelineCounters;
  job: AdminFirestore.DocumentReference<JobDoc>;
}
