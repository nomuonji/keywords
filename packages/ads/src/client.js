"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeywordIdeaClient = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
class KeywordIdeaClient {
    auth;
    constructor(auth) {
        this.auth = auth;
        this.auth = auth;
    }
    async generateIdeas(params) {
        const { node, settings } = params;
        const seedText = node.title;
        const { locale, locationIds, languageId, maxResults, minVolume, maxCompetition } = settings.ads;
        return this.generateKeywordIdeas({
            projectId: settings.projectId,
            seedText,
            locale,
            locationIds,
            languageId,
            maxResults,
            minVolume,
            maxCompetition
        });
    }
    async generateKeywordIdeas(params) {
        const endpoint = process.env.KEYWORD_VOLUME_API_URL;
        if (!endpoint) {
            throw new Error('KEYWORD_VOLUME_API_URL is not configured.');
        }
        const payload = {
            keywords: [params.seedText],
            options: {
                includeAdultKeywords: true,
                languageConstant: String(params.languageId),
                geoTargetConstants: params.locationIds.map((id) => String(id))
            }
        };
        const response = await retry(async () => {
            const res = await (0, node_fetch_1.default)(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const body = await res.text();
                throw new Error(`Keyword API error ${res.status}: ${body}`);
            }
            return res.json();
        });
        const ideas = normaliseResponse(response).map((item) => {
            const metrics = {
                avgMonthly: item.avgMonthlySearches,
                competition: normaliseCompetitionScore(item),
                competitionIndex: item.competitionIndex ?? item.competition,
                competitionLevel: item.competitionLevel,
                lowTopOfPageBidMicros: item.lowTopOfPageBidMicros,
                highTopOfPageBidMicros: item.highTopOfPageBidMicros,
                cpcMicros: item.highTopOfPageBidMicros
            };
            return {
                keyword: item.keyword,
                metrics
            };
        });
        return ideas
            .filter((idea) => !!idea.keyword)
            .filter((idea) => {
            const volume = idea.metrics.avgMonthly ?? 0;
            const competition = idea.metrics.competition ?? 0;
            return volume >= params.minVolume && competition <= params.maxCompetition;
        })
            .slice(0, params.maxResults);
    }
}
exports.KeywordIdeaClient = KeywordIdeaClient;
async function retry(fn, retries = 3, delayMs = 500) {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            return await fn();
        }
        catch (error) {
            attempt += 1;
            if (attempt > retries) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
        }
    }
}
function normaliseResponse(response) {
    if ('results' in response && Array.isArray(response.results)) {
        return response.results.map((item) => ({
            keyword: item.keyword ?? item.keywordText ?? '',
            ...item
        }));
    }
    return Object.entries(response).map(([keyword, metrics]) => ({
        keyword,
        ...metrics
    }));
}
function normaliseCompetitionScore(item) {
    const value = (typeof item.competition === 'number' ? item.competition : undefined) ??
        (typeof item.competitionIndex === 'number' ? item.competitionIndex : undefined);
    if (value === undefined) {
        return undefined;
    }
    const numeric = Math.max(0, Math.min(100, value));
    return Number((numeric / 100).toFixed(3));
}
