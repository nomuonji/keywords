"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WordpressMedia = void 0;
const axios_1 = __importDefault(require("axios"));
class WordpressMedia {
    config;
    constructor(config) {
        this.config = config;
    }
    async post(article) {
        const { data } = await axios_1.default.post(`${this.config.url}/wp-json/wp/v2/posts`, {
            title: 'New Post',
            content: article,
            status: 'publish',
        }, {
            headers: {
                Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
            },
        });
        return data.id;
    }
    async getUrl(postId) {
        const { data } = await axios_1.default.get(`${this.config.url}/wp-json/wp/v2/posts/${postId}`);
        return data.link;
    }
}
exports.WordpressMedia = WordpressMedia;
