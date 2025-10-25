import { GeminiClient } from '@keywords/gemini';
import { TavilyClient } from '@tavily/core';
import { BlogPost, BlogMediaConfig } from './types';
export declare class Blogger {
    private readonly gemini;
    private readonly tavily;
    constructor(gemini: GeminiClient, tavily: TavilyClient);
    private createMedia;
    createPost(outline: any, config: BlogMediaConfig): Promise<BlogPost>;
}
//# sourceMappingURL=blogger.d.ts.map