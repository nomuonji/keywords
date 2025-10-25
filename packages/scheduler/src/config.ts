import type { AdsAuthConfig } from '@keywords/ads';
import type { GeminiConfig } from '@keywords/gemini';

export interface TavilyConfig {
  apiKey?: string;
}

export interface EnvironmentConfig {
  ads: AdsAuthConfig;
  gemini: GeminiConfig;
  tavily: TavilyConfig;
  firestore: {
    projectId?: string;
    databaseId?: string;
  };
}

export function loadConfig(): EnvironmentConfig {
  const required: string[] = [];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
  return {
    ads: {
      developerToken: process.env.ADS_DEVELOPER_TOKEN,
      clientId: process.env.ADS_CLIENT_ID,
      clientSecret: process.env.ADS_CLIENT_SECRET,
      refreshToken: process.env.ADS_REFRESH_TOKEN,
      loginCustomerId: process.env.ADS_LOGIN_CUSTOMER_ID,
      customerId: process.env.ADS_CUSTOMER_ID
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      embeddingModel: process.env.GEMINI_EMBEDDING_MODEL,
      generativeModel: process.env.GEMINI_GENERATIVE_MODEL
    },
    tavily: {
      apiKey: process.env.TAVILY_API_KEY
    },
    firestore: {
      projectId: process.env.GCP_PROJECT_ID,
      databaseId: process.env.FIRESTORE_DB
    }
  };
}
