import { z } from 'zod';

// First-party public curation feeds and official story APIs reveal actual
// source -> outbound-destination edges. They do NOT reveal traffic or conversions.
const RSS_FEEDS = [
  { id: 'hatena_general', family: 'cross_category_curation', url: 'https://b.hatena.ne.jp/hotentry.rss', market: 'JP' },
  { id: 'hatena_technology', family: 'technology_curation', url: 'https://b.hatena.ne.jp/hotentry/it.rss', market: 'JP' }
] as const;
const HN_STORIES_URL = 'https://hacker-news.firebaseio.com/v0/showstories.json';
const HN_ITEM = (id: number) => 'https://hacker-news.firebaseio.com/v0/item/' + id + '.json';
const MAX_RESPONSE = 900_000;

export const distributionCaseDiscoveryShape = {
  topic: z.string().trim().min(2).max(120).optional(),
  maxCases: z.number().int().min(1).max(24).optional(),
  includeGlobalTech: z.boolean().optional(),
  maxAgeDays: z.number().int().min(1).max(30).optional()
};

type Input = {
  topic?: string;
  maxCases?: number;
  includeGlobalTech?: boolean;
  maxAgeDays?: number;
};
type Case = {
  sourceId: string;
  sourceMarket: string;
  sourceFamily: string;
  discoverySourceUrl: string;
  sourcePostUrl: string | null;
  destinationUrl: string;
  destinationDomain: string;
  title: string;
  publishedAt: string | null;
  engagement: { metric: 'bookmarks' | 'upvotes' | 'comments'; value: number; provenance: string }[];
  evidenceClass: 'observed_curated_outbound_link';
  permissionToPublish: 'unknown';
  observedVisits: null;
  observedConversions: null;
};
type Http = {
  fetchText?: (url: string, timeoutMs: number) => Promise<string>;
  fetchJson?: (url: string, timeoutMs: number) => Promise<unknown>;
  clock?: () => number;
};

function externalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password || !url.hostname || url.hostname === 'localhost') return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}
function host(url: string) { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
function entities(raw: string) {
  return raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([a-f0-9]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&#([0-9]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, x => ({
      '&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&apos;':"'", '&nbsp;':' '
    }[x] || x));
}
const one = (body: string, tag: string): string | null => {
  const re = new RegExp('<(?:[a-z0-9_-]+:)?' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?' + tag + '>', 'i');
  const match = re.exec(body);
  return match ? entities(match[1]).trim() : null;
};
function instant(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}
function ageOk(date: string | null, now: number, days: number) {
  if (!date) return true; // unverified date, not fabricated freshness
  const age = now - Date.parse(date);
  return age >= -86400000 && age <= days * 86400000;
}
function tokens(raw: string) {
  // Explicit topic is used for literal relevance filtering AFTER market feeds are sampled,
  // never for the selection of the sources or generation of industry seeds.
  return raw.toLowerCase().normalize('NFKC').split(/[\s,、，／\/・()（）]+/).filter(x => x.length >= 2);
}
function topicMatches(title: string, topic?: string) {
  if (!topic) return true;
  const terms = tokens(topic);
  return !terms.length || terms.some(t => title.toLowerCase().normalize('NFKC').includes(t));
}
function short(raw: unknown, limit = 200) {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, limit) : '';
}

export function parseHatenaDistributionRss(xml: string, feed: { id:string; family:string; url:string; market:string }, now: number, maxAgeDays: number): Case[] {
  const cases: Case[] = [];
  for (const found of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = found[1];
    const destination = externalUrl(one(block,'link'));
    const title = short(one(block,'title'));
    if (!destination || !title) continue;
    if (/^(?:b\.)?hatena\.ne\.jp$/.test(host(destination))) continue;
    const date = instant(one(block,'date') ?? one(block,'pubDate'));
    if (!ageOk(date, now, maxAgeDays)) continue;
    const rawCount = one(block, 'bookmarkcount');
    const n = rawCount && /^\d+$/.test(rawCount) ? Number(rawCount) : null;
    cases.push({
      sourceId: feed.id, sourceMarket: feed.market, sourceFamily: feed.family,
      discoverySourceUrl: feed.url, sourcePostUrl: null,
      destinationUrl: destination, destinationDomain: host(destination), title,
      publishedAt: date,
      engagement: n !== null && Number.isSafeInteger(n)
        ? [{ metric: 'bookmarks', value: n, provenance: 'hatena_rss_bookmarkcount' }]
        : [],
      evidenceClass: 'observed_curated_outbound_link',
      permissionToPublish: 'unknown', observedVisits: null, observedConversions: null
    });
  }
  return cases;
}
type HnItem = {
  id?: number; type?: string; url?: string; title?: string; time?: number;
  score?: number; descendants?: number; dead?: boolean; deleted?: boolean;
};
export function parseHackerNewsDistribution(items: HnItem[], now: number, maxAgeDays: number): Case[] {
  const cases: Case[] = [];
  for (const item of items) {
    if (item?.dead || item?.deleted || item?.type !== 'story' || !Number.isSafeInteger(item.id) || (item.id ?? 0) <= 0) continue;
    const url = externalUrl(item.url);
    const title = short(item.title);
    if (!url || !title || host(url) === 'news.ycombinator.com') continue;
    const date = typeof item.time === 'number' && Number.isFinite(item.time)
      ? new Date(item.time * 1000).toISOString() : null;
    if (!ageOk(date, now, maxAgeDays)) continue;
    const engagement: Case['engagement'] = [];
    if (Number.isSafeInteger(item.score) && item.score! >= 0)
      engagement.push({ metric:'upvotes', value:item.score!, provenance:'hn_official_story_api' });
    if (Number.isSafeInteger(item.descendants) && item.descendants! >= 0)
      engagement.push({ metric:'comments', value:item.descendants!, provenance:'hn_official_story_api' });
    cases.push({
      sourceId:'hacker_news_show', sourceMarket:'global', sourceFamily:'new_product_showcase',
      discoverySourceUrl:HN_STORIES_URL,
      sourcePostUrl:'https://news.ycombinator.com/item?id=' + item.id,
      destinationUrl:url, destinationDomain:host(url), title, publishedAt:date,
      engagement, evidenceClass:'observed_curated_outbound_link',
      permissionToPublish:'unknown', observedVisits:null, observedConversions:null
    });
  }
  return cases;
}
async function textFetch(url: string, timeout: number) {
  const res = await fetch(url, { headers: { Accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw Error('HTTP ' + res.status);
  const length = Number(res.headers.get('content-length') || 0);
  if (length > MAX_RESPONSE) throw Error('response_too_large');
  const result = await res.text();
  if (result.length > MAX_RESPONSE) throw Error('response_too_large');
  return result;
}
async function jsonFetch(url: string, timeout: number) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw Error('HTTP ' + res.status);
  const length = Number(res.headers.get('content-length') || 0);
  if (length > MAX_RESPONSE) throw Error('response_too_large');
  const result = await res.text();
  if (result.length > MAX_RESPONSE) throw Error('response_too_large');
  return JSON.parse(result);
}
function interleave(groups: Case[][], max: number) {
  const result: Case[] = [], seen = new Set<string>();
  let cursor = 0;
  while (result.length < max && groups.some(g => cursor < g.length)) {
    for (const group of groups) {
      const item = group[cursor];
      if (item && !seen.has(item.destinationUrl)) {
        seen.add(item.destinationUrl);
        result.push(item);
        if (result.length === max) break;
      }
    }
    cursor++;
  }
  return result;
}
export async function distributionCaseDiscovery(input: unknown = {}, deps: Http = {}) {
  const args = z.object(distributionCaseDiscoveryShape).strict().parse(input);
  const now = deps.clock?.() ?? Date.now(), maxAgeDays = args.maxAgeDays ?? 7, limit = args.maxCases ?? 12;
  const loadText = deps.fetchText ?? textFetch, loadJson = deps.fetchJson ?? jsonFetch;
  const health: Array<{sourceId:string; status:string; url:string; rawCases:number; warning?:string }> = [];
  const allGroups: Case[][] = [];
  for (const feed of RSS_FEEDS) {
    try {
      const parsed = parseHatenaDistributionRss(await loadText(feed.url, 8000), feed, now, maxAgeDays);
      health.push({ sourceId:feed.id, status:parsed.length ? 'observed' : 'empty', url:feed.url, rawCases:parsed.length });
      allGroups.push(parsed.filter(x => topicMatches(x.title, args.topic)));
    } catch (e) {
      health.push({sourceId:feed.id,status:'unavailable',url:feed.url,rawCases:0,
        warning: e instanceof Error ? e.message.slice(0,120) : 'source_failed' });
    }
  }
  if (args.includeGlobalTech ?? true) {
    let ids: number[] = [];
    try {
      const fetched = await loadJson(HN_STORIES_URL, 8000);
      if (!Array.isArray(fetched)) throw Error('invalid_story_list');
      ids = fetched.filter((v):v is number => Number.isSafeInteger(v) && v > 0).slice(0, 12);
      const items = await Promise.allSettled(ids.map(id => loadJson(HN_ITEM(id), 5000)));
      const parsed = parseHackerNewsDistribution(items.filter((x):x is PromiseFulfilledResult<unknown> => x.status === 'fulfilled').map(x=>x.value as HnItem), now, maxAgeDays);
      health.push({sourceId:'hacker_news_show', status:parsed.length ? 'observed' : 'empty',url:HN_STORIES_URL,rawCases:parsed.length,
        ...(items.some(x=>x.status === 'rejected') ? {warning:'some_items_unavailable'} : {})});
      allGroups.push(parsed.filter(x=>topicMatches(x.title,args.topic)));
    } catch (e) {
      health.push({sourceId:'hacker_news_show',status:'unavailable',url:HN_STORIES_URL,rawCases:0,
        warning:e instanceof Error ? e.message.slice(0,120) : 'source_failed'});
    }
  }
  const cases = interleave(allGroups, limit);
  const domainCounts = new Map<string,number>();
  for (const group of allGroups) for (const item of group) domainCounts.set(item.destinationDomain,(domainCounts.get(item.destinationDomain)||0)+1);
  return {
    fetchedAt:new Date(now).toISOString(), topic:args.topic ?? null,
    status:cases.length ? 'observed_real_distribution_edges' : 'insufficient_observations',
    startingPoint:'public_discovery_feed_entries_not_model_named_channels',
    scope:{maxCases:limit, maxAgeDays, requestedSources:health.length,
      maxUpstreamFetches:args.includeGlobalTech === false ? 2 : 15,
      estimatedFirestoreReads:0, estimatedFirestoreWrites:0, estimatedSerpCalls:0},
    sources:health, cases:cases.map(c=>({
      ...c, repeatsInSample:domainCounts.get(c.destinationDomain) ?? 1,
      reproducibility:'not_yet_verified', placementEligibility:'not_yet_verified'
    })),
    observedDestinationDomains:[...new Set(cases.map(c=>c.destinationDomain))],
    nextInvestigation:[
      'Trace the observed source entry to the actual linked destination, then inspect the content, creator and its CTA where publicly available.',
      'Verify whether this venue accepts original submissions or earned editorial pickup, and whether external click-through is enabled and lawful.',
      'Compare with relevant buyers, creation cost, and an attributable UTM/referral experiment before recommending it.',
      'Sample engagement signals (bookmarks, votes, comments) are NOT referral sessions, purchases, or revenue.',
      'No posting, promotion, or contact attempt has been made. An unavailable feed is not a market absence signal.'
    ]
  };
}
