import type { NodeDoc, ProjectSettings } from '../core';
import type {
  AdsAuthConfig,
  GenerateKeywordIdeasParams,
  KeywordIdea,
  KeywordMetrics
} from './types';

type FetchFn = typeof globalThis.fetch;
let fetchInstance: FetchFn | null = null;

async function getFetch(): Promise<FetchFn> {
  if (fetchInstance) {
    return fetchInstance;
  }
  if (typeof globalThis.fetch === 'function') {
    fetchInstance = globalThis.fetch.bind(globalThis);
    return fetchInstance;
  }
  const mod = await import('node-fetch');
  const fetched = ((mod as { default?: unknown }).default ?? mod) as unknown as FetchFn;
  if (typeof fetched !== 'function') {
    throw new Error('Failed to load fetch implementation');
  }
  fetchInstance = fetched;
  return fetchInstance;
}

interface KeywordIdeaApiResponse {
  keyword: string;
  metrics?: KeywordMetrics;
}

interface KeywordIdeaApiPayload {
  keywords: string[];
  options: {
    includeAdultKeywords: boolean;
    languageConstant?: string;
    geoTargetConstants?: string[];
  };
}

export class KeywordIdeaClient {
  constructor(private readonly auth: AdsAuthConfig) {
    this.auth = auth;
  }

  async generateIdeas(params: { node: NodeDoc; settings: ProjectSettings; }): Promise<{ keyword: string; metrics: KeywordMetrics; }[]> {
    const { node, settings } = params;
    const seedText = node.title;
    const { locale, locationIds, languageId, maxResults, minVolume, maxCompetition } = settings.ads;
    return this.generateKeywordIdeas({
      projectId: settings.projectId,
      seedText,
      locale,
      locationIds,
      languageId,
      maxResults,
      minVolume,
      maxCompetition
    });
  }

  async generateKeywordIdeas(params: GenerateKeywordIdeasParams): Promise<KeywordIdea[]> {
    const endpoint = process.env.KEYWORD_VOLUME_API_URL;
    if (!endpoint) {
      throw new Error('KEYWORD_VOLUME_API_URL is not configured.');
    }

    const payload: KeywordIdeaApiPayload = {
      keywords: [params.seedText],
      options: {
        includeAdultKeywords: true,
        languageConstant: String(params.languageId),
        geoTargetConstants: params.locationIds.map((id) => String(id))
      }
    };

    const fetchFn = await getFetch();
    const response = await retry(async () => {
      const res = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Keyword API error ${res.status}: ${body}`);
      }
      return res.json() as Promise<Record<string, KeywordVolumeResponse> | KeywordVolumeResponseWrapper>;
    });

    const ideas: KeywordIdea[] = normaliseResponse(response).map((item) => {
      const metrics: KeywordMetrics = {
        avgMonthly: item.avgMonthlySearches,
        competition: normaliseCompetitionScore(item),
        competitionIndex: item.competitionIndex ?? item.competition,
        competitionLevel: item.competitionLevel,
        lowTopOfPageBidMicros: item.lowTopOfPageBidMicros,
        highTopOfPageBidMicros: item.highTopOfPageBidMicros,
        cpcMicros: item.highTopOfPageBidMicros
      };
      return {
        keyword: item.keyword,
        metrics
      };
    });

    return ideas
      .filter((idea) => !!idea.keyword)
      .filter((idea) => {
        const volume = idea.metrics.avgMonthly ?? 0;
        const competition = idea.metrics.competition ?? 0;
        return volume >= params.minVolume && competition <= params.maxCompetition;
      })
      .slice(0, params.maxResults);
  }
}

async function retry<T>(fn: () => Promise<T>, retries = 3, delayMs = 500): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}

type KeywordVolumeResponseWrapper = {
  results?: KeywordVolumeResponse[];
};

type KeywordVolumeResponse = {
  avgMonthlySearches?: number;
  competition?: number;
  competitionIndex?: number;
  competitionLevel?: string;
  lowTopOfPageBidMicros?: number;
  highTopOfPageBidMicros?: number;
  keywordText?: string;
  keyword?: string;
};

function normaliseResponse(
  response: Record<string, KeywordVolumeResponse> | KeywordVolumeResponseWrapper
): Array<{ keyword: string } & KeywordVolumeResponse> {
  if ('results' in response && Array.isArray(response.results)) {
    return response.results.map((item) => ({
      keyword: item.keyword ?? item.keywordText ?? '',
      ...item
    }));
  }
  return Object.entries(response).map(([keyword, metrics]) => ({
    keyword,
    ...metrics
  }));
}

function normaliseCompetitionScore(item: KeywordVolumeResponse): number | undefined {
  const value =
    (typeof item.competition === 'number' ? item.competition : undefined) ??
    (typeof item.competitionIndex === 'number' ? item.competitionIndex : undefined);
  if (value === undefined) {
    return undefined;
  }
  const numeric = Math.max(0, Math.min(100, value));
  return Number((numeric / 100).toFixed(3));
}
