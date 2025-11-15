import type {
  Intent,
  ProjectSettings,
  GroupSummary,
  GroupDocWithId,
  KeywordDocWithId,
} from '../core';

export interface GrokConfig {
  apiKey: string;
  generativeModel?: string;
  embeddingModel?: string;
}

export interface EmbedKeywordsInput {
  projectId: string;
  keywords: Array<{ id: string; text: string }>;
}

export type EmbedKeywordsOutput = {
  id: string;
  vector: number[];
};

export interface SummarizeClusterInput {
  groupId: string;
  representativeKw: string;
  intent?: Intent;
  description?: string;
  keywords: KeywordDocWithId[];
  settings: ProjectSettings;
}

export type SummarizeClusterOutput = GroupSummary;

export interface SuggestThemesInput {
  description: string;
}

export type SuggestThemesOutput = string[];

export interface SuggestNodesInput {
  projectDescription: string;
  theme: string;
  existingNodes: string[];
}

export type SuggestNodesOutput = string[];

export interface ClusterKeywordsInput {
  keywords: Array<{ id: string; text: string }>;
}

export type ClusterKeywordsOutput = Array<{
  keywords: Array<{ id: string; text: string }>;
}>;
