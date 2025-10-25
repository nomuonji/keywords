import { GeminiClient } from '@keywords/gemini';
import { tavily } from '@tavily/core';
import { BlogMedia, BlogPost } from './types';

type TavilyClient = ReturnType<typeof tavily>;

export class Blogger {
  private readonly gemini: GeminiClient;
  private readonly tavily: TavilyClient;

  constructor(
    gemini: GeminiClient,
    tavily: TavilyClient,
  ) {
    this.gemini = gemini;
    this.tavily = tavily;
  }

  async createPost(outline: any, media: BlogMedia): Promise<BlogPost> {
    const research = await this.tavily.search(outline.title, {
      maxResults: 5,
    });

    const article = await this.gemini.generateArticle({
      outline,
      research: JSON.stringify(research),
    });

    const postId = await media.post(article);

    return {
      postId,
      url: await media.getUrl(postId),
    };
  }
}
