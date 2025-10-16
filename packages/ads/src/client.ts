import { retry } from '@keywords/core';
import type { AdsAuthConfig, GenerateKeywordIdeasParams, KeywordIdea } from './types';

/**
 * KeywordPlan の GenerateKeywordIdeas を呼び出すクライアント。
 * 現状は Google Ads API への実リクエスト実装をモック化している。
 * TODO: google-ads API SDK と統合し、実データを取得する処理へ差し替える。
 */
export class KeywordIdeaClient {
  constructor(private readonly auth: AdsAuthConfig) {
    this.auth = auth;
  }

  async generateKeywordIdeas(params: GenerateKeywordIdeasParams): Promise<KeywordIdea[]> {
    return retry(async () => {
      // 現時点ではモック応答として空配列を返す。
      // 実装時は Google Ads API (KeywordPlanIdeaService) を呼び出し、
      // params.seedText や locationIds を元にレスポンスを整形する。
      void this.auth;
      void params;
      return [];
    });
  }
}
