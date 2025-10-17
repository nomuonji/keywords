import type { GroupSummary, Intent, KeywordDoc, ProjectSettings } from '@keywords/core';

export interface GeminiConfig {
  apiKey?: string;
  embeddingModel?: string;
  generativeModel?: string;
}

export interface EmbedKeywordsInput {
  projectId: string;
  keywords: Array<{ id: string; text: string }>;
}

export interface EmbedKeywordsOutput {
  id: string;
  vector: number[];
}

export interface SummarizeClusterInput {
  groupId: string;
  representativeKw: string;
  intent: Intent;
  description: string;
  keywords: Array<{ text: string; metrics: KeywordDoc['metrics'] }>;
  settings: ProjectSettings;
}

export type SummarizeClusterOutput = GroupSummary;
