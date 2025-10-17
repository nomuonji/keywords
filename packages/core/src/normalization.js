"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeKeyword = normalizeKeyword;
const node_crypto_1 = __importDefault(require("node:crypto"));
const STOPWORDS = new Set(['の', 'が', 'を', 'に', 'と', 'は', 'へ', 'で', 'や', 'から', 'まで']);
/**
 * Normalize Japanese keywords for deduplication.
 * - NFKC normalization
 * - lower-case Latin characters
 * - trim punctuation
 * - remove stopwords tokens
 */
function normalizeKeyword(input) {
    const nfkc = input.normalize('NFKC');
    const lower = nfkc.toLowerCase();
    const trimmed = lower
        .replace(/["'「」『』]/g, '')
        .replace(/[、・,.;:!?！？]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const tokens = trimmed
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length > 0 && !STOPWORDS.has(token));
    const normalized = tokens.join(' ');
    const hash = node_crypto_1.default.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
    return { normalized, hash };
}
