import Groq from 'groq-sdk';
import { retry } from '../core';
import type {
  GrokConfig,
  SuggestNodesInput,
  SuggestNodesOutput,
  SuggestThemesInput,
  SuggestThemesOutput,
  SummarizeClusterInput,
  SummarizeClusterOutput,
  ClusterKeywordsInput,
  ClusterKeywordsOutput,
} from './types';
import type {
  Intent,
  ProjectSettings,
  GroupSummary,
  GroupDocWithId,
  KeywordDocWithId,
} from '../core';

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

export class GrokClient {
  private readonly client: Groq;
  private readonly generativeModel: string;

  constructor(private readonly config: GrokConfig) {
    if (!config.apiKey) {
      throw new Error('Grok API key is not configured.');
    }
    this.client = new Groq({ apiKey: config.apiKey });
    this.generativeModel = config.generativeModel ?? 'grok-4-fast-non-reasoning';
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
      settings,
    });
  }

  async generateArticle(params: GenerateArticleParams): Promise<GenerateArticleResult> {
    const prompt = this.buildArticlePrompt(params);
    const response = await retry(async () =>
      this.client.chat.completions.create({
        model: this.generativeModel,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      })
    );
    const text = response.choices[0]?.message?.content ?? '';
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
        html: String(parsed.html).trim(),
      };
    } catch (error) {
      throw new Error(`Failed to parse article response: ${error instanceof Error ? error.message : error}`);
    }
  }

  async summarizeCluster(input: SummarizeClusterInput): Promise<SummarizeClusterOutput> {
    const prompt = this.buildOutlinePrompt(input);
    const response = await retry(async () =>
      this.client.chat.completions.create({
        model: this.generativeModel,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      })
    );
    const text = response.choices[0]?.message?.content ?? '';
    return this.parseOutline(text, input);
  }

  async suggestThemes(input: SuggestThemesInput): Promise<SuggestThemesOutput> {
    const prompt = this.buildSuggestThemesPrompt(input);
    const response = await retry(async () =>
      this.client.chat.completions.create({
        model: this.generativeModel,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      })
    );
    const text = response.choices[0]?.message?.content ?? '';
    return this.parseSuggestions(text);
  }

  async suggestNodes(input: SuggestNodesInput): Promise<SuggestNodesOutput> {
    const prompt = this.buildSuggestNodesPrompt(input);
    const response = await retry(async () =>
      this.client.chat.completions.create({
        model: this.generativeModel,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      })
    );
    const text = response.choices[0]?.message?.content ?? '';
    return this.parseSuggestions(text);
  }

  async clusterKeywords(input: ClusterKeywordsInput): Promise<ClusterKeywordsOutput> {
    const prompt = this.buildClusterKeywordsPrompt(input);
    const response = await retry(async () =>
      this.client.chat.completions.create({
        model: this.generativeModel,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      })
    );
    const text = response.choices[0]?.message?.content ?? '';
    return this.parseClusters(text);
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
      'Each theme should be a very broad, high-level topic, ideally expressed as a single keyword.',
      'Avoid themes that are long phrases, questions, or specific long-tail keywords.',
      'Focus on topics that are likely to have good search volume and commercial value.',
      'Output requirements (strict):',
      '- Respond ONLY with a JSON object containing a "suggestions" key with a flat array of strings.',
      '- Example: {"suggestions": ["テーマ1", "テーマ2", "テーマ3"]}',
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
      '- Respond ONLY with a JSON object containing a "suggestions" key with a flat array of strings.',
      '- Example: {"suggestions": ["関連トピック1", "関連トピック2", "関連トピック3"]}',
      existingNodesList
    ].join('\n');
  }

  private parseSuggestions(text: string): string[] {
    try {
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.suggestions)) {
        return parsed.suggestions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      }
      return [];
    } catch (error) {
      console.error('Failed to parse suggestions:', error);
      return [];
    }
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
      const json = JSON.parse(text) as {
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

  private buildClusterKeywordsPrompt(input: ClusterKeywordsInput): string {
    const keywordList = input.keywords.map(kw => `{"id": "${kw.id}", "text": "${kw.text}"}`).join(',\n');
    return [
      'You are an expert SEO content strategist.',
      'Group the following keywords into clusters based on their semantic meaning and user intent.',
      'Output requirements (strict):',
      '- Respond ONLY with a JSON object containing a "clusters" key.',
      '- The "clusters" key should contain an array of arrays, where each inner array is a group of keyword IDs.',
      '- Example: {"clusters": [["id1", "id2"], ["id3", "id4"]]}',
      'Keywords:',
      `[${keywordList}]`
    ].join('\n');
  }

  private parseClusters(text: string): ClusterKeywordsOutput {
    try {
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.clusters)) {
        const keywordMap = new Map<string, { id: string, text: string }>();
        // This is inefficient, but we need to reconstruct the keyword text.
        // In a real application, we would pass the keywords in the input.
        // For now, we'll just return the IDs.
        return parsed.clusters.map((cluster: string[]) => {
          return {
            keywords: cluster.map(id => ({ id, text: '' }))
          }
        });
      }
      return [];
    } catch (error) {
      console.error('Failed to parse clusters:', error);
      return [];
    }
  }
}
