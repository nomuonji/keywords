import type { Intent, ProjectSettings, GroupSummary } from '@keywords/core';
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import type { GroupDocWithId, KeywordDocWithId } from '@keywords/scheduler';
import { retry } from '@keywords/core';
import type {
  EmbedKeywordsInput,
  EmbedKeywordsOutput,
  GeminiConfig,
  SummarizeClusterInput,
  SummarizeClusterOutput
} from './types';

export class GeminiClient {
  private readonly client: GoogleGenerativeAI;
  private readonly embeddingModel: string;
  private readonly generativeModel: string;

  constructor(private readonly config: GeminiConfig) {
    if (!config.apiKey) {
      throw new Error('Gemini API key is not configured.');
    }
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.embeddingModel = this.normalizeModelId(
      config.embeddingModel ?? 'models/text-embedding-004'
    );
    this.generativeModel = this.normalizeModelId(
      config.generativeModel ?? 'models/gemini-2.5-flash'
    );
  }

  async embed(keywords: { id: string; text: string }[]): Promise<{ id: string; vector: number[] }[]> {
    return this.embedKeywords({ projectId: '', keywords });
  }

  async summarize(params: {
    group: GroupDocWithId;
    keywords: KeywordDocWithId[];
    settings: ProjectSettings;
  }): Promise<GroupSummary> {
    const { group, keywords, settings } = params;
    return this.summarizeCluster({
      groupId: group.id,
      representativeKw: group.clusterStats.topKw ?? '',
      intent: group.intent,
      description: group.summary?.description ?? '',
      keywords,
      settings
    });
  }

  async embedKeywords(input: EmbedKeywordsInput): Promise<EmbedKeywordsOutput[]> {
    if (input.keywords.length === 0) {
      return [];
    }
    const model = this.getModel(this.embeddingModel);
    const vectors: number[][] = [];
    const chunkSize = 100;
    for (let start = 0; start < input.keywords.length; start += chunkSize) {
      const slice = input.keywords.slice(start, start + chunkSize);
      if (slice.length === 1) {
        const [{ vector }] = await retry(async () => this.embedIndividual(model, slice));
        vectors.push(vector);
        continue;
      }
      const result = await retry(async () =>
        model.batchEmbedContents({
          requests: slice.map((kw) => ({
            content: { parts: [{ text: kw.text }] }
          }))
        })
      );
      if (!result.embeddings?.length) {
        throw new Error('Gemini API returned no embeddings');
      }
      if (result.embeddings.length !== slice.length) {
        throw new Error('Gemini embedding count mismatch for chunk');
      }
      result.embeddings.forEach((emb) => vectors.push(emb.values));
    }
    if (vectors.length !== input.keywords.length) {
      throw new Error('Gemini embedding count mismatch');
    }
    return input.keywords.map((kw, idx) => ({
      id: kw.id,
      vector: vectors[idx]
    }));
  }

  async summarizeCluster(input: SummarizeClusterInput): Promise<SummarizeClusterOutput> {
    const prompt = this.buildOutlinePrompt(input);
    const model = this.getModel(this.generativeModel);
    const response = await retry(async () =>
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      })
    );
    const text =
      response.response?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('\n') ?? '';
    return this.parseOutline(text);
  }

  async classifyIntent(text: string): Promise<Intent> {
    const prompt = `Classify the dominant search intent for the keyword below. Respond with one token: info, trans, local, or mixed.\nKeyword: ${text}`;
    const model = this.getModel(this.generativeModel);
    const response = await retry(async () =>
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      })
    );
    const answer =
      response.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase();
    if (answer === 'trans' || answer === 'local' || answer === 'mixed') {
      return answer;
    }
    return 'info';
  }

  private normalizeModelId(model: string): string {
    return model.startsWith('models/') ? model : `models/${model}`;
  }

  private getModel(model: string): GenerativeModel {
    return this.client.getGenerativeModel({ model });
  }

  private async embedIndividual(
    model: GenerativeModel,
    keywords: Array<{ id: string; text: string }>
  ): Promise<Array<{ id: string; vector: number[] }>> {
    const results: Array<{ id: string; vector: number[] }> = [];
    for (const keyword of keywords) {
      const result = await model.embedContent({
        content: { parts: [{ text: keyword.text }] }
      });
      if (!result.embedding?.values?.length) {
        throw new Error('Gemini API returned no embedding vector');
      }
      results.push({ id: keyword.id, vector: result.embedding.values });
    }
    return results;
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

  private parseOutline(text: string): GroupSummary {
    try {
      const json = JSON.parse(text);
      const summary: GroupSummary = {
        id: '',
        title: '',
        description: '',
        outlineTitle: json.outlineTitle ?? '',
        h2: Array.isArray(json.h2) ? json.h2 : [],
        intent: 'info'
      };
      if (Array.isArray(json.h3)) {
        summary.h3 = json.h3;
      }
      if (Array.isArray(json.faq)) {
        summary.faq = json.faq.map((item: { q: string; a: string }) => ({ q: item.q, a: item.a }));
      }
      return summary;
    } catch (error) {
      return {
        id: '',
        title: '',
        description: '',
        outlineTitle: '',
        h2: [],
        h3: undefined,
        faq: undefined,
        intent: 'info'
      };
    }
  }
}
