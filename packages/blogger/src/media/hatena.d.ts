import { BlogMedia, HatenaConfig } from '../types';
export declare class HatenaMedia implements BlogMedia {
    private readonly config;
    constructor(config: HatenaConfig);
    post(article: string): Promise<string>;
    getUrl(postId: string): Promise<string>;
}
//# sourceMappingURL=hatena.d.ts.map