import { BlogMedia, WordpressConfig } from '../types';
export declare class WordpressMedia implements BlogMedia {
    private readonly config;
    constructor(config: WordpressConfig);
    post(article: string): Promise<string>;
    getUrl(postId: string): Promise<string>;
}
//# sourceMappingURL=wordpress.d.ts.map