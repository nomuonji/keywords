import type { Intent, ProjectSettings, GroupSummary, GroupDocWithId, KeywordDocWithId } from '@keywords/core';
import type { EmbedKeywordsInput, EmbedKeywordsOutput, GeminiConfig, SummarizeClusterInput, SummarizeClusterOutput, SuggestNodesInput, SuggestNodesOutput, SuggestThemesInput, SuggestThemesOutput } from './types';
export declare class GeminiClient {
    private readonly config;
    private readonly client;
    private readonly embeddingModel;
    private readonly generativeModel;
    constructor(config: GeminiConfig);
    embed(keywords: {
        id: string;
        text: string;
    }[]): Promise<{
        id: string;
        vector: number[];
    }[]>;
    summarize(params: {
        group: GroupDocWithId;
        keywords: KeywordDocWithId[];
        settings: ProjectSettings;
    }): Promise<GroupSummary>;
    embedKeywords(input: EmbedKeywordsInput): Promise<EmbedKeywordsOutput[]>;
    summarizeCluster(input: SummarizeClusterInput): Promise<SummarizeClusterOutput>;
    classifyIntent(text: string): Promise<Intent>;
    suggestThemes(input: SuggestThemesInput): Promise<SuggestThemesOutput>;
    suggestNodes(input: SuggestNodesInput): Promise<SuggestNodesOutput>;
    private buildSuggestThemesPrompt;
    private buildSuggestNodesPrompt;
    private parseSuggestions;
    private normalizeModelId;
    private getModel;
    private embedIndividual;
    private buildOutlinePrompt;
    private parseOutline;
    private extractJson;
    private buildDefaultTitle;
    private buildFallbackH2;
    private buildFallbackSummary;
}
//# sourceMappingURL=client.d.ts.map