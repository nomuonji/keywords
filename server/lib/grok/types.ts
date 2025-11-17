
import type { KeywordDocWithId, ProjectSettings, GroupDocWithId, Intent, GroupSummary } from '../core';

export interface GrokConfig {
  apiKey: string;
  generativeModel?: string;
}

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

export interface SummarizeClusterInput {
  groupId: string;
  representativeKw: string;
  intent?: Intent;
  description?: string;
  keywords: KeywordDocWithId[];
  settings: ProjectSettings;
}

export type SummarizeClusterOutput = GroupSummary;

export type ClusterKeywordsInput = {
  keywords: Array<{ id: string; text: string }>;
};

export type ClusterKeywordsOutput = Array<{
  keywords: Array<{ id: string; text: string }>;
}>;
