import crypto from 'node:crypto';

const STOPWORDS = new Set(['の', 'が', 'を', 'に', 'と', 'は', 'へ', 'で', 'や', 'から', 'まで']);

export interface NormalizedKeyword {
  normalized: string;
  hash: string;
}

/**
 * Normalize Japanese keywords for deduplication.
 * - NFKC normalization
 * - lower-case Latin characters
 * - trim punctuation
 * - remove stopwords tokens
 */
export function normalizeKeyword(input: string): NormalizedKeyword {
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
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
  return { normalized, hash };
}
