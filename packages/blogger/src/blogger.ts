import { GeminiClient } from '@keywords/gemini';
import { TavilyClient } from 'tavily-node';
import { BlogMedia, BlogPost, BlogMediaConfig } from './types';
import { WordpressMedia, HatenaMedia } from './media';

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

  private createMedia(config: BlogMediaConfig): BlogMedia {
    switch (config.platform) {
      case 'wordpress':
        return new WordpressMedia(config);
      case 'hatena':
        return new HatenaMedia(config);
      default:
        throw new Error(`Unsupported blog platform: ${config.platform}`);
    }
  }

  async createPost(outline: any, config: BlogMediaConfig): Promise<BlogPost> {
    const media = this.createMedia(config);

    const research = await this.tavily.search(outline.title, {
      max_results: 5,
      search_depth: 'basic'
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
