import type { AdsAuthConfig } from '@keywords/ads';
import type { GeminiConfig } from '@keywords/gemini';

export interface EnvironmentConfig {
  ads: AdsAuthConfig;
  gemini: GeminiConfig;
  firestore: {
    projectId?: string;
    databaseId?: string;
  };
}

export function loadConfig(): EnvironmentConfig {
  const required = [
    'ADS_DEVELOPER_TOKEN',
    'ADS_CLIENT_ID',
    'ADS_CLIENT_SECRET',
    'ADS_REFRESH_TOKEN',
    'ADS_CUSTOMER_ID',
    'GEMINI_API_KEY'
  ];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
  return {
    ads: {
      developerToken: process.env.ADS_DEVELOPER_TOKEN!,
      clientId: process.env.ADS_CLIENT_ID!,
      clientSecret: process.env.ADS_CLIENT_SECRET!,
      refreshToken: process.env.ADS_REFRESH_TOKEN!,
      loginCustomerId: process.env.ADS_LOGIN_CUSTOMER_ID,
      customerId: process.env.ADS_CUSTOMER_ID!
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY!,
      embeddingModel: process.env.GEMINI_EMBEDDING_MODEL,
      generativeModel: process.env.GEMINI_GENERATIVE_MODEL
    },
    firestore: {
      projectId: process.env.GCP_PROJECT_ID,
      databaseId: process.env.FIRESTORE_DB
    }
  };
}
