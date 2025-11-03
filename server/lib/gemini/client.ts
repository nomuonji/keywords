import type {
  Intent,
  ProjectSettings,
  GroupSummary,
  GroupDocWithId,
  KeywordDocWithId
} from '../core';
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { retry } from '../core';
import type {
  EmbedKeywordsInput,
  EmbedKeywordsOutput,
  GeminiConfig,
  SummarizeClusterInput,
  SummarizeClusterOutput,
  SuggestNodesInput,
  SuggestNodesOutput,
  SuggestThemesInput,
  SuggestThemesOutput
} from './types';

type GenerateArticleParams = {
  outline: any;
  research: string;
  topic?: string;
  intent?: Intent;
  language?: string;
};

type GenerateArticleResult = {
  title: string;
  html: string;
};

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

  async generateArticle(params: GenerateArticleParams): Promise<GenerateArticleResult> {
    const prompt = this.buildArticlePrompt(params);
    const model = this.getModel(this.generativeModel);
    const response = await retry(async () =>
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    );
    const text =
      response.response?.candidates?.[0]?.content?.parts
        ?.map((part: any) => part.text ?? '')
        .join('\n') ?? '';
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Article response is not an object');
      }
      if (!parsed.title || !parsed.html) {
        throw new Error('Article response missing title or html fields');
      }
      return {
        title: String(parsed.title).trim(),
        html: String(parsed.html).trim()
      };
    } catch (error) {
      throw new Error(`Failed to parse article response: ${error instanceof Error ? error.message : error}`);
    }
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
            content: { role: 'user', parts: [{ text: kw.text }] }
          }))
        })
      );
      if (!result.embeddings?.length) {
        throw new Error('Gemini API returned no embeddings');
      }
      if (result.embeddings.length !== slice.length) {
        throw new Error('Gemini embedding count mismatch for chunk');
      }
      result.embeddings.forEach((emb: any) => vectors.push(emb.values));
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
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    );
    const text =
      response.response?.candidates?.[0]?.content?.parts
        ?.map((part: any) => part.text ?? '')
        .join('\n') ?? '';
    return this.parseOutline(text, input);
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

  async suggestThemes(input: SuggestThemesInput): Promise<SuggestThemesOutput> {
    const prompt = this.buildSuggestThemesPrompt(input);
    const model = this.getModel(this.generativeModel);
    const response = await retry(async () =>
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    );
    const text =
      response.response?.candidates?.[0]?.content?.parts
        ?.map((part: any) => part.text ?? '')
        .join('\n') ?? '';
    return this.parseSuggestions(text);
  }

  async suggestNodes(input: SuggestNodesInput): Promise<SuggestNodesOutput> {
    const prompt = this.buildSuggestNodesPrompt(input);
    const model = this.getModel(this.generativeModel);
    const response = await retry(async () =>
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    );
    const text =
      response.response?.candidates?.[0]?.content?.parts
        ?.map((part: any) => part.text ?? '')
        .join('\n') ?? '';
    console.log('---- Gemini Response ----\n', text);
    return this.parseSuggestions(text);
  }

  private buildArticlePrompt(params: GenerateArticleParams): string {
    const topic = params.topic ?? params.outline?.outlineTitle ?? 'ブログ記事';
    const intent = params.intent ?? 'info';
    const languageCode = (params.language ?? 'ja').toLowerCase();
    const languageName = this.describeLanguage(languageCode);
    const writerDescriptor =
      languageCode === 'ja' ? 'Japanese' : `${languageName} bilingual (Japanese/English-capable)`;
    const titleGuideline =
      languageCode === 'ja'
        ? '60 Japanese characters'
        : '60 characters in the target language';
    const punctuationHint =
      languageCode === 'ja'
        ? 'Use Japanese punctuation and full-width characters where appropriate.'
        : 'Use natural punctuation and typography for the selected language.';
    return [
      `You are an expert ${writerDescriptor} SEO copywriter and editor.`,
      `Primary topic: ${topic}`,
      `Search intent: ${intent}`,
      `Target language: ${languageName}.`,
      'Use the provided outline JSON and research JSON to craft a compelling, comprehensive article.',
      'Formatting rules:',
      `- Write entirely in natural ${languageName}.`,
      '- Return valid JSON with keys "title" and "html".',
      `- "title" should be an engaging headline under ${titleGuideline}.`,
      '- "html" must be a complete <article>...</article> fragment that includes:',
      '  * One <h1> for the main headline (matching the title).',
      '  * Multiple <section> blocks with <h2> / <h3> headings derived from the outline.',
      '  * Rich formatting: <p>, <strong>, <em>, <ul>/<ol>, <blockquote>, and tables when helpful.',
      `- ${punctuationHint}`,
      '- Avoid Markdown, code fences, script tags, or inline styles.',
      '- Embed key research insights with natural paraphrasing and cite sources in-text when relevant.',
      'Outline JSON:',
      JSON.stringify(params.outline, null, 2),
      'Research JSON:',
      params.research
    ].join('\n');
  }

  private describeLanguage(code: string): string {
    switch (code) {
      case 'en':
      case 'en-us':
      case 'en-gb':
        return 'English';
      case 'zh':
      case 'zh-cn':
      case 'zh-tw':
        return 'Chinese';
      case 'ko':
        return 'Korean';
      case 'fr':
        return 'French';
      case 'es':
        return 'Spanish';
      case 'de':
        return 'German';
      case 'th':
        return 'Thai';
      case 'vi':
        return 'Vietnamese';
      default:
        return 'Japanese';
    }
  }

  private buildSuggestThemesPrompt(input: SuggestThemesInput): string {
    return [
      'You are an expert SEO content strategist.',
      `The overall goal of this project is: "${input.description}"`,
      'Based on the project goal, please suggest 5-10 potential content themes.',
      'Each theme should be a broad topic category that can be broken down into more specific subtopics.',
      'Avoid suggesting specific, long-tail article titles. Focus on the larger categories.',
      'Focus on topics that are likely to have good search volume and commercial value.',
      'Output requirements (strict):',
      '- Your response MUST start with ```json and end with ```.',
      '- Inside the JSON code block, provide a single flat array of strings.',
      '- Do not include any text or commentary before or after the JSON block.',
      '- Example: ```json\n["テーマカテゴリ1", "テーマカテゴリ2", "テーマカテゴリ3"]\n```',
      'Project Description:',
      input.description
    ].join('\n');
  }

  private buildSuggestNodesPrompt(input: SuggestNodesInput): string {
    const existingNodesList =
      input.existingNodes.length > 0
        ? `Existing nodes:\n${input.existingNodes.map((node) => `- ${node}`).join('\n')}`
        : 'No existing nodes yet.';

    return [
      'You are an expert SEO content strategist.',
      `The overall goal of this project is: "${input.projectDescription}"`,
      `The current content theme is "${input.theme}".`,
      'Based on the project goal and the current theme, please suggest 5-10 related topics.',
      'Each topic should be a broader category or a general concept, not a specific article title.',
      'Avoid duplicating existing topics.',
      'Output requirements (strict):',
      '- Respond ONLY with a JSON code block containing a flat array of strings.',
      '- Example: ```json\n["関連トピック1", "関連トピック2", "関連トピック3"]\n```',
      existingNodesList
    ].join('\n');
  }

  private parseSuggestions(text: string): string[] {
    try {
      const target = this.extractJson(text);
      const json = JSON.parse(target) as unknown;
      if (Array.isArray(json)) {
        return json.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      }
      return [];
    } catch (error) {
      console.error('Failed to parse suggestions:', error);
      return [];
    }
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
        content: { role: 'user', parts: [{ text: keyword.text }] }
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
      'You are an SEO strategist drafting a high-quality article outline in natural Japanese.',
      `Representative keyword: ${input.representativeKw}`,
      `Search intent: ${input.intent}`,
      `Cluster description: ${input.description}`,
      'Use the keyword list to infer searcher problems and desired solutions.',
      'Output requirements (strict):',
      '- Respond ONLY with JSON. No commentary or code fences.',
      '- JSON schema: {"outlineTitle": string, "h2": string[], "h3": Record<string,string[]>, "faq": Array<{ "q": string, "a": string }>}',
      '- Each heading must be descriptive, natural Japanese, without prefixes like "H2" or numbering.',
      '- h2 should contain 4-6 entries. For headings needing subtopics, include them as h3[h2Heading] = [...subheadings].',
      '- Provide 2-4 FAQ pairs that address intent-specific concerns.',
      '- Keep outlineTitle concise (<= 28 full-width characters when possible).',
      'Context keywords:',
      keywordList
    ].join('\n');
  }

  private parseOutline(text: string, input: SummarizeClusterInput): GroupSummary {
    try {
      const target = this.extractJson(text);
      const json = JSON.parse(target) as {
        outlineTitle?: unknown;
        description?: unknown;
        h2?: unknown;
        h3?: unknown;
        faq?: unknown;
      };
      const outlineTitle =
        typeof json.outlineTitle === 'string' && json.outlineTitle.trim().length
          ? json.outlineTitle.trim()
          : this.buildDefaultTitle(input);
      const description =
        typeof json.description === 'string' ? json.description.trim() : input.description ?? '';
      let h2: string[] = [];
      if (Array.isArray(json.h2)) {
        h2 = json.h2
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => item.trim());
      }
      if (!h2.length) {
        h2 = this.buildFallbackH2(input);
      }
      const summary: GroupSummary = {
        id: input.groupId,
        title: input.representativeKw || input.groupId,
        description,
        outlineTitle,
        h2,
        intent: input.intent ?? 'info'
      };
      if (json.h3 && typeof json.h3 === 'object' && !Array.isArray(json.h3)) {
        const h3Record: Record<string, string[]> = {};
        Object.entries(json.h3).forEach(([key, value]) => {
          if (!Array.isArray(value)) {
            return;
          }
          const cleaned = value
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .map((item) => item.trim());
          if (cleaned.length) {
            h3Record[key] = cleaned;
          }
        });
        if (Object.keys(h3Record).length) {
          summary.h3 = h3Record;
        }
      }
      if (Array.isArray(json.faq)) {
        const cleanedFaq = json.faq
          .map((item) => {
            if (!item || typeof item !== 'object') return undefined;
            const q = (item as { q?: unknown }).q;
            const a = (item as { a?: unknown }).a;
            if (typeof q !== 'string' || typeof a !== 'string') return undefined;
            if (!q.trim().length || !a.trim().length) return undefined;
            return { q: q.trim(), a: a.trim() };
          })
          .filter((item): item is { q: string; a: string } => !!item);
        if (cleanedFaq.length) {
          summary.faq = cleanedFaq;
        }
      }
      return summary;
    } catch (error) {
      return this.buildFallbackSummary(input);
    }
  }

  private extractJson(text: string): string {
    // First, try to find a JSON code block.
    const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/i);
    if (codeBlockMatch?.[1]) {
      return codeBlockMatch[1].trim();
    }

    // If no code block, find the largest valid JSON object or array within the text.
    let startIndex = -1;
    let endIndex = -1;

    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    const lastBrace = text.lastIndexOf('}');
    const lastBracket = text.lastIndexOf(']');

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      // Prefers object if it appears first.
      startIndex = firstBrace;
      endIndex = lastBrace;
    } else if (firstBracket !== -1) {
      // Otherwise, looks for an array.
      startIndex = firstBracket;
      endIndex = lastBracket;
    }

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      try {
        const potentialJson = text.slice(startIndex, endIndex + 1);
        // A quick validation to see if it's likely JSON.
        JSON.parse(potentialJson);
        return potentialJson;
      } catch (e) {
        // Ignore parsing errors here, we'll throw a generic error later.
      }
    }

    throw new Error('Gemini response did not contain a valid JSON object or array');
  }

  private buildDefaultTitle(input: SummarizeClusterInput): string {
    return input.representativeKw || input.keywords[0]?.text || 'Outline Plan';
  }

  private buildFallbackH2(input: SummarizeClusterInput): string[] {
    const uniqueKeywords = Array.from(
      new Set(
        input.keywords
          .map((kw) => kw.text.trim())
          .filter((text) => text.length > 0)
      )
    );
    if (!uniqueKeywords.length) {
      return [
        `Key basics: ${input.representativeKw ?? input.groupId}`,
        'Related topics overview',
        'Practical tips and cautions'
      ];
    }
    return uniqueKeywords.slice(0, 5).map((text) => `Deep dive: ${text}`);
  }

  private buildFallbackSummary(input: SummarizeClusterInput): GroupSummary {
    return {
      id: input.groupId,
      title: input.representativeKw || input.groupId,
      description: input.description ?? '',
      outlineTitle: this.buildDefaultTitle(input),
      h2: this.buildFallbackH2(input),
      intent: input.intent ?? 'info'
    };
  }
}
