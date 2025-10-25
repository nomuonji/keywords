"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Blogger = void 0;
const media_1 = require("./media");
class Blogger {
    gemini;
    tavily;
    constructor(gemini, tavily) {
        this.gemini = gemini;
        this.tavily = tavily;
    }
    createMedia(config) {
        if (config.platform === 'wordpress') {
            return new media_1.WordpressMedia(config);
        }
        else if (config.platform === 'hatena') {
            return new media_1.HatenaMedia(config);
        }
        else {
            throw new Error(`Unsupported blog platform`);
        }
    }
    async createPost(outline, config) {
        const media = this.createMedia(config);
        const research = await this.tavily.search(outline.title, {
            maxResults: 5,
        });
        const article = await this.gemini.summarize({
            group: outline,
            keywords: [],
            settings: {},
        });
        const postId = await media.post(JSON.stringify(article));
        return {
            postId,
            url: await media.getUrl(postId),
        };
    }
}
exports.Blogger = Blogger;
