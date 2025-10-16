import fetch from 'node-fetch';
import type { Intent } from '@keywords/core';
import { retry } from '@keywords/core';
import type {
  EmbedKeywordsInput,
  EmbedKeywordsOutput,
  GeminiConfig,
  SummarizeClusterInput,
  SummarizeClusterOutput
} from './types';

const DEFAULT_EMBEDDING_MODEL = 'models/text-embedding-004';
const DEFAULT_GENERATIVE_MODEL = 'models/gemini-1.5-pro-latest';

export class GeminiClient {
  private embeddingModel: string;
  private generativeModel: string;

  constructor(private readonly config: GeminiConfig) {
    this.embeddingModel = config.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
    this.generativeModel = config.generativeModel ?? DEFAULT_GENERATIVE_MODEL;
  }

  async embedKeywords(input: EmbedKeywordsInput): Promise<EmbedKeywordsOutput[]> {
    if (input.keywords.length === 0) {
      return [];
    }
    const body = {
      model: this.embeddingModel,
      input: input.keywords.map((kw) => kw.text),
      task_type: 'retrieval_query'
    };
    const response = await this.apiRequest<{ embeddings: { values: number[] }[] }>(
      'v1beta/models/embedContent',
      body
    );
    return response.embeddings.map((emb, idx) => ({
      id: input.keywords[idx].id,
      vector: emb.values
    }));
  }

  async summarizeCluster(input: SummarizeClusterInput): Promise<SummarizeClusterOutput> {
    const prompt = this.buildOutlinePrompt(input);
    const body = {
      contents: [{ parts: [{ text: prompt }] }]
    };
    const response = await this.apiRequest<{
      candidates: Array<{
        content: { parts: Array<{ text?: string }> };
      }>;
    }>(`v1beta/${this.generativeModel}:generateContent`, body);

    const text =
      response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('\n') ?? '';
    return this.parseOutline(text);
  }

  async classifyIntent(text: string): Promise<Intent> {
    const prompt = `Classify the dominant search intent for the keyword below. Respond with one token: info, trans, local, or mixed.\nKeyword: ${text}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }]
    };
    const response = await this.apiRequest<{
      candidates: Array<{
        content: { parts: Array<{ text?: string }> };
      }>;
    }>(`v1beta/${this.generativeModel}:generateContent`, body);
    const answer = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase();
    if (answer === 'trans' || answer === 'local' || answer === 'mixed') {
      return answer;
    }
    return 'info';
  }

  private async apiRequest<T>(path: string, body: unknown): Promise<T> {
    const url = `https://generativelanguage.googleapis.com/${path}?key=${this.config.apiKey}`;
    return retry(async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Gemini API error: ${res.status} ${text}`);
      }
      return (await res.json()) as T;
    });
  }

  private buildOutlinePrompt(input: SummarizeClusterInput): string {
    const keywordList = input.keywords
      .map((kw) => `- ${kw.text} (volume: ${kw.metrics.avgMonthly ?? 'n/a'})`)
      .join('\n');
    return [
      'You are an SEO strategist creating article outlines.',
      `Representative keyword: ${input.representativeKw}`,
      `Search intent: ${input.intent}`,
      `Cluster description: ${input.description}`,
      'Provide a concise outline with the following structure:',
      'Title (<= 70 characters), H2 headings, optional H3 subheadings, and 2-4 FAQ pairs.',
      'Return JSON with keys outlineTitle, h2 (array), optional h3 (array), faq (array of {q,a}).',
      'Keywords with metrics:',
      keywordList
    ].join('\n');
  }

  private parseOutline(text: string): SummarizeClusterOutput {
    try {
      const json = JSON.parse(text);
      return {
        outlineTitle: json.outlineTitle ?? '',
        h2: Array.isArray(json.h2) ? json.h2 : [],
        h3: Array.isArray(json.h3) ? json.h3 : undefined,
        faq: Array.isArray(json.faq)
          ? json.faq.map((item: { q: string; a: string }) => ({
              q: item.q,
              a: item.a
            }))
          : undefined
      };
    } catch {
      return {
        outlineTitle: '',
        h2: [],
        h3: undefined,
        faq: undefined
      };
    }
  }
}
