import type { KeywordMetrics } from '@keywords/core';

export interface AdsAuthConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  loginCustomerId?: string;
  customerId: string;
}

export interface GenerateKeywordIdeasParams {
  projectId: string;
  seedText: string;
  locale: string;
  locationIds: number[];
  languageId: number;
  maxResults: number;
  minVolume: number;
  maxCompetition: number;
}

export interface KeywordIdea {
  keyword: string;
  metrics: KeywordMetrics;
}
