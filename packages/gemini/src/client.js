"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiClient = void 0;
const generative_ai_1 = require("@google/generative-ai");
const core_1 = require("@keywords/core");
class GeminiClient {
    config;
    client;
    embeddingModel;
    generativeModel;
    constructor(config) {
        this.config = config;
        if (!config.apiKey) {
            throw new Error('Gemini API key is not configured.');
        }
        this.client = new generative_ai_1.GoogleGenerativeAI(config.apiKey);
        this.embeddingModel = this.normalizeModelId(config.embeddingModel ?? 'models/text-embedding-004');
        this.generativeModel = this.normalizeModelId(config.generativeModel ?? 'models/gemini-2.5-flash');
    }
    async embed(keywords) {
        return this.embedKeywords({ projectId: '', keywords });
    }
    async summarize(params) {
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
    async embedKeywords(input) {
        if (input.keywords.length === 0) {
            return [];
        }
        const model = this.getModel(this.embeddingModel);
        const vectors = [];
        const chunkSize = 100;
        for (let start = 0; start < input.keywords.length; start += chunkSize) {
            const slice = input.keywords.slice(start, start + chunkSize);
            if (slice.length === 1) {
                const [single] = await (0, core_1.retry)(async () => this.embedIndividual(model, slice));
                vectors.push(single.vector);
                continue;
            }
            const result = await (0, core_1.retry)(async () => model.batchEmbedContents({
                requests: slice.map((kw) => ({
                    content: { parts: [{ text: kw.text }] }
                }))
            }));
            if (!result.embeddings?.length) {
                throw new Error('Gemini API returned no embeddings');
            }
            if (result.embeddings.length !== slice.length) {
                throw new Error('Gemini embedding count mismatch for chunk');
            }
            result.embeddings.forEach((emb) => vectors.push(emb.values));
        }
        if (vectors.length !== input.keywords.length) {
            throw new Error('Gemini embedding count mismatch');
        }
        return input.keywords.map((kw, idx) => ({
            id: kw.id,
            vector: vectors[idx]
        }));
    }
    async summarizeCluster(input) {
        const prompt = this.buildOutlinePrompt(input);
        const model = this.getModel(this.generativeModel);
        const response = await (0, core_1.retry)(async () => model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        }));
        const text = response.response?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('\n') ?? '';
        return this.parseOutline(text);
    }
    async classifyIntent(text) {
        const prompt = `Classify the dominant search intent for the keyword below. Respond with one token: info, trans, local, or mixed.\nKeyword: ${text}`;
        const model = this.getModel(this.generativeModel);
        const response = await (0, core_1.retry)(async () => model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        }));
        const answer = response.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase();
        if (answer === 'trans' || answer === 'local' || answer === 'mixed') {
            return answer;
        }
        return 'info';
    }
    normalizeModelId(model) {
        return model.startsWith('models/') ? model : `models/${model}`;
    }
    getModel(model) {
        return this.client.getGenerativeModel({ model });
    }
    async embedIndividual(model, keywords) {
        const results = [];
        for (const keyword of keywords) {
            const result = await model.embedContent({
                content: { parts: [{ text: keyword.text }] }
            });
            if (!result.embedding?.values?.length) {
                throw new Error('Gemini API returned no embedding vector');
            }
            results.push({ id: keyword.id, vector: result.embedding.values });
        }
        return results;
    }
    buildOutlinePrompt(input) {
        const keywordList = input.keywords
            .map((kw) => `- ${kw.text} (volume: ${kw.metrics.avgMonthly ?? 'n/a'})`)
            .join('\n');
        return [
            'You are an SEO strategist creating article outlines.',
            `Representative keyword: ${input.representativeKw}`,
            `Search intent: ${input.intent}`,
            `Cluster description: ${input.description}`,
            'Provide a concise outline with the following structure:',
            'Title (<= 70 characters), H2 headings, optional H3 subheadings, and 2-4 FAQ pairs.',
            'Return JSON with keys outlineTitle, h2 (array), optional h3 (array), faq (array of {q,a}).',
            'Keywords with metrics:',
            keywordList
        ].join('\n');
    }
    parseOutline(text) {
        try {
            const json = JSON.parse(text);
            const summary = {
                id: '',
                title: '',
                description: '',
                outlineTitle: json.outlineTitle ?? '',
                h2: Array.isArray(json.h2) ? json.h2 : [],
                intent: 'info'
            };
            if (Array.isArray(json.h3)) {
                summary.h3 = json.h3;
            }
            if (Array.isArray(json.faq)) {
                summary.faq = json.faq.map((item) => ({ q: item.q, a: item.a }));
            }
            return summary;
        }
        catch (error) {
            return {
                id: '',
                title: '',
                description: '',
                outlineTitle: '',
                h2: [],
                h3: undefined,
                faq: undefined,
                intent: 'info'
            };
        }
    }
}
exports.GeminiClient = GeminiClient;
