import { GeminiClient } from '../gemini';
import { GrokClient } from '../grok';
import { tavily } from '@tavily/core';
import type { GroupDocWithId } from '../core';
import { BlogMedia, BlogPost } from './types';

type TavilyClient = ReturnType<typeof tavily>;
type AiClient = GeminiClient | GrokClient;

export class Blogger {
  private readonly aiClient: AiClient;
  private readonly tavily: TavilyClient;

  constructor(aiClient: AiClient, tavily: TavilyClient) {
    this.aiClient = aiClient;
    this.tavily = tavily;
  }

  async createPost(
    group: GroupDocWithId,
    media: BlogMedia,
    options?: { language?: string }
  ): Promise<BlogPost> {
    const summary = group.summary ?? {
      outlineTitle: group.title,
      h2: [],
      h3: {},
      faq: []
    };
    const researchTopic = summary.outlineTitle ?? group.title;
    const research = await this.tavily.search(researchTopic, {
      maxResults: 5
    });

    const article = await this.aiClient.generateArticle({
      outline: summary,
      research: JSON.stringify(research),
      topic: group.title,
      intent: group.intent,
      language: options?.language
    });

    const title = article.title?.trim() || summary.outlineTitle || group.title;
    const content = article.html?.trim();
    if (!content) {
      throw new Error('Generated article content is empty');
    }

    const postId = await media.post({ title, content });

    return {
      postId,
      url: await media.getUrl(postId)
    };
  }
}
