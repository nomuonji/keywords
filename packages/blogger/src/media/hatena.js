"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HatenaMedia = void 0;
const axios_1 = __importDefault(require("axios"));
const fast_xml_parser_1 = require("fast-xml-parser");
class HatenaMedia {
    config;
    constructor(config) {
        this.config = config;
    }
    async post(article) {
        const builder = new fast_xml_parser_1.XMLBuilder({
            ignoreAttributes: false,
            format: true,
        });
        const xmlContent = builder.build({
            entry: {
                '@_xmlns': 'http://www.w3.org/2005/Atom',
                '@_xmlns:app': 'http://www.w3.org/2007/app',
                title: 'New Post',
                author: { name: 'Jules' },
                content: {
                    '@_type': 'text/plain',
                    '#text': article,
                },
                category: {
                    '@_term': 'API',
                },
                'app:control': {
                    'app:draft': 'no',
                },
            },
        });
        const { data } = await axios_1.default.post(`https://blog.hatena.ne.jp/${this.config.hatenaId}/${this.config.blogId}/atom/entry`, xmlContent, {
            headers: {
                'Content-Type': 'application/xml',
                Authorization: `Basic ${Buffer.from(`${this.config.hatenaId}:${this.config.apiKey}`).toString('base64')}`,
            },
        });
        const parser = new fast_xml_parser_1.XMLParser();
        const parsed = parser.parse(data);
        return parsed.entry.id;
    }
    async getUrl(postId) {
        const { data } = await axios_1.default.get(`https://blog.hatena.ne.jp/${this.config.hatenaId}/${this.config.blogId}/atom/entry/${postId}`, {
            headers: {
                Authorization: `Basic ${Buffer.from(`${this.config.hatenaId}:${this.config.apiKey}`).toString('base64')}`,
            },
        });
        const parser = new fast_xml_parser_1.XMLParser();
        const parsed = parser.parse(data);
        return parsed.entry.link.find((l) => l['@_rel'] === 'alternate')['@_href'];
    }
}
exports.HatenaMedia = HatenaMedia;
