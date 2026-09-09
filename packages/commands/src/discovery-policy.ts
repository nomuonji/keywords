import type { DemandStatus } from '@keywords/domain';

export function classifyDemandStatus(provider: string | null | undefined, value: number | null | undefined): DemandStatus {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return provider === 'search_surface_observed' ? 'search_surface_observed' : 'unverified';
  }
  if (provider === 'gsc' || provider === 'gsc_snapshot' || provider === 'search_console') return 'gsc_observed';
  if (provider === 'google_ads') return 'provider_estimated';
  return 'unverified';
}

export function isVerifiedDemand(status: string | null | undefined, value: number | null | undefined) {
  return (status === 'provider_estimated' || status === 'gsc_observed') && value !== null && value !== undefined && Number.isFinite(value);
}

/**
 * A seed itself is not discovery. A phrase must stay in the seed's lexical
 * family and gets more points as it adds explicit modifiers. This is a
 * transparent lexical measure, not an opaque relevance or SEO score.
 */
export function noveltyScore(normalizedPhrase: string, normalizedSeeds: string[]) {
  if (!normalizedSeeds.length) return 2;
  let best = 0;
  for (const seed of normalizedSeeds) {
    if (!seed || normalizedPhrase === seed) continue;
    const seedTokens = seed.split(/[\s,、。\-_/|:：・]+/).filter(Boolean);
    const phraseTokens = normalizedPhrase.split(/[\s,、。\-_/|:：・]+/).filter(Boolean);
    const anchor = seedTokens.find(value => /[A-Za-z]/.test(value)) ?? seedTokens[0];
    if (!anchor || !phraseTokens.includes(anchor)) continue;
    if (phraseTokens.every(token => seedTokens.includes(token))) continue;
    const extraTokens = phraseTokens.filter(token => !seedTokens.includes(token)).length;
    const coversSeed = seedTokens.every(token => phraseTokens.includes(token));
    best = Math.max(best, Math.min(3, 1 + extraTokens + (coversSeed ? 1 : 0)));
  }
  return best;
}

/**
 * Give a keyword-volume provider one lexical parent per seed so it can return
 * ideas without mixing in unrelated parent topics. Added values are explicit
 * tokens from a human seed; no phrase is invented.
 */
export function providerSeedKeywords(seedKeywords: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const text = value.trim();
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    result.push(text);
  };
  for (const seed of seedKeywords) {
    add(seed);
    const tokens = seed.split(/[\s,、。/|:：・]+/).map(value => value.trim()).filter(value => [...value].length >= 2);
    const lexicalParent = tokens.find(value => /[A-Za-z]/.test(value)) ?? tokens[0];
    if (lexicalParent) add(lexicalParent);
  }
  return result.slice(0, 20);
}
