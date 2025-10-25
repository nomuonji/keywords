export interface WordpressConfig {
    platform: 'wordpress';
    url: string;
    username: string;
    password: string;
}
export interface HatenaConfig {
    platform: 'hatena';
    apiKey: string;
    blogId: string;
    hatenaId: string;
}
export type BlogMediaConfig = WordpressConfig | HatenaConfig;
export interface BlogMedia {
    post(article: string): Promise<string>;
    getUrl(postId: string): Promise<string>;
}
export interface BlogPost {
    postId: string;
    url: string;
}
//# sourceMappingURL=types.d.ts.map