import { z } from 'zod';

// First-party public curation feeds and official story APIs reveal actual
// source -> outbound-destination edges. They do NOT reveal traffic or conversions.
const RSS_FEEDS = [
  { id: 'hatena_general', family: 'cross_category_curation', url: 'https://b.hatena.ne.jp/hotentry.rss', market: 'JP' },
  { id: 'hatena_life', family: 'lifestyle_curation', url: 'https://b.hatena.ne.jp/hotentry/life.rss', market: 'JP' },
  { id: 'hatena_fun', family: 'humor_and_creativity_curation', url: 'https://b.hatena.ne.jp/hotentry/fun.rss', market: 'JP' },
  { id: 'hatena_knowledge', family: 'learning_curation', url: 'https://b.hatena.ne.jp/hotentry/knowledge.rss', market: 'JP' },
  { id: 'hatena_entertainment', family: 'entertainment_curation', url: 'https://b.hatena.ne.jp/hotentry/entertainment.rss', market: 'JP' },
  { id: 'hatena_game', family: 'games_and_anime_curation', url: 'https://b.hatena.ne.jp/hotentry/game.rss', market: 'JP' },
  { id: 'hatena_technology', family: 'technology_curation', url: 'https://b.hatena.ne.jp/hotentry/it.rss', market: 'JP' },
  { id: 'hatena_social', family: 'social_curation', url: 'https://b.hatena.ne.jp/hotentry/social.rss', market: 'JP' },
  { id: 'hatena_economics', family: 'economics_curation', url: 'https://b.hatena.ne.jp/hotentry/economics.rss', market: 'JP' }
] as const;
const HN_STORIES_URL = 'https://hacker-news.firebaseio.com/v0/showstories.json';
const HN_ITEM = (id: number) => 'https://hacker-news.firebaseio.com/v0/item/' + id + '.json';
const MAX_RESPONSE = 900_000;

export const distributionCaseDiscoveryShape = {
  topic: z.string().trim().min(2).max(120).optional(),
  maxCases: z.number().int().min(1).max(24).optional(),
  includeGlobalTech: z.boolean().optional(),
  maxAgeDays: z.number().int().min(1).max(30).optional(),
  rotation: z.number().int().min(0).max(100).optional(),
  focus: z.enum(['balanced','entertainment','fandom','everyday','technology']).optional(),
  niche: z.string().trim().min(2).max(80).optional()
};

type Input = {
  topic?: string;
  maxCases?: number;
  includeGlobalTech?: boolean;
  maxAgeDays?: number;
  rotation?: number;
  focus?: 'balanced' | 'entertainment' | 'fandom' | 'everyday' | 'technology';
  niche?: string;
};
type Case = {
  sourceId: string;
  sourcePlatform: 'hatena_bookmark' | 'hacker_news';
  sourceMarket: string;
  sourceFamily: string;
  discoverySourceUrl: string;
  sourcePostUrl: string | null;
  destinationUrl: string;
  destinationDomain: string;
  title: string;
  observedTags: string[];
  publishedAt: string | null;
  timestampProvenance: 'rss_entry_timestamp' | 'hn_story_timestamp';
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
function topicMatches(title: string, topic?: string, tags: string[] = []) {
  if (!topic) return true;
  const terms = tokens(topic);
  const haystack = [title,...tags].join(' ').toLowerCase().normalize('NFKC');
  return !terms.length || terms.some(t => haystack.includes(t));
}
// A named fandom must have literal backing in an observed title or provider tag;
// it is not inferred from a model's knowledge of a series or character.
function nicheMatches(c: Case, niche?: string) {
  if (!niche) return true;
  const terms = tokens(niche);
  const haystack = [c.title,...c.observedTags].join(' ').toLowerCase().normalize('NFKC');
  return terms.length > 0 && terms.every(term => haystack.includes(term));
}
// Legacy focus options may influence which results appear first, but NEVER
// exclude a domain or a source. An enum is not the universe of real niches.
// Arbitrary user-supplied niche strings and previously unseen RSS tags are supported.
const LEGACY_FOCUS_ORDER: Record<NonNullable<Input['focus']>, string[]> = {
  balanced: [],
  entertainment: ['hatena_entertainment','hatena_game','hatena_fun','hatena_life'],
  fandom: ['hatena_game','hatena_entertainment','hatena_fun'],
  everyday: ['hatena_life','hatena_fun','hatena_knowledge'],
  technology: ['hatena_technology','hatena_knowledge']
};
const ALL_CONTEXT_NEUTRAL_TAGS = new Set(['あとで読む','まとめ','news','ニュース','話題','はてな','ブログ','blog']);
function providerTags(block: string): string[] {
  const tags:string[] = [];
  // Hatena RSS 1.0 dc:subject is provider-labelled metadata, not guessed topic text.
  for (const [,raw] of block.matchAll(/<dc:subject(?:\s[^>]*)?>([\s\S]*?)<\/dc:subject>/gi)) {
    const tag = entities(raw).replace(/<[^>]+>/g,'').trim().slice(0,60);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= 16) break;
  }
  return tags;
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
    const observedTags = providerTags(block);
    const rawCount = one(block, 'bookmarkcount');
    const n = rawCount && /^\d+$/.test(rawCount) ? Number(rawCount) : null;
    cases.push({
      sourceId: feed.id, sourcePlatform:'hatena_bookmark', sourceMarket: feed.market, sourceFamily: feed.family,
      discoverySourceUrl: feed.url, sourcePostUrl: null,
      destinationUrl: destination, destinationDomain: host(destination), title, observedTags,
      publishedAt: date, timestampProvenance: 'rss_entry_timestamp',
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
      sourceId:'hacker_news_show', sourcePlatform:'hacker_news', sourceMarket:'global', sourceFamily:'new_product_showcase',
      discoverySourceUrl:HN_STORIES_URL,
      sourcePostUrl:'https://news.ycombinator.com/item?id=' + item.id,
      destinationUrl:url, destinationDomain:host(url), title, observedTags:[], publishedAt:date, timestampProvenance:'hn_story_timestamp',
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
type HeadlineClue = { kind: string; matchedText: string; provenance: 'literal_title_match' };
const HEADLINE_CLUES: Array<{kind:string; pattern:RegExp}> = [
  { kind:'interactive_experience', pattern: /診断|シミュレー(?:ター|ション)|クイズ|遊べる|体験|interactive|quiz|game you can play/i },
  { kind:'utility_or_free_tool', pattern: /無料|ツール|便利|アプリ|自作|作った|計算機|チェッカー|open.source|virtual|generator|tool|utility|free app/i },
  { kind:'original_data_or_reference', pattern: /データ|一覧|調査結果|統計|集計|可視化|データベース|比較表|dataset|database|visualization|benchmark/i },
  { kind:'practical_walkthrough', pattern: /手順|使い方|やり方|入門|解説|管理しやすく|まとめ|チェックリスト|how to|tutorial|guide/i },
  { kind:'news_or_editorial', pattern: /速報|警告|発表|報じ|恐れ|事件|news|breaking|announced|warning/i }
];
// Hints are literal headline tokens, not conclusions about the linked page or its CTA.
export function headlineFormatClues(title: string): HeadlineClue[] {
  const clues: HeadlineClue[] = [];
  for (const rule of HEADLINE_CLUES) {
    const m = rule.pattern.exec(title);
    if (m) clues.push({kind:rule.kind, matchedText:m[0], provenance:'literal_title_match'});
  }
  return clues;
}
function interleave(groups: Case[][], max: number) {
  const result: Case[] = [], seen = new Set<string>(), domainUse = new Map<string,number>();
  let cursor = 0;
  while (result.length < max && groups.some(g => cursor < g.length)) {
    for (const group of groups) {
      const item = group[cursor];
      if (!item || seen.has(item.destinationUrl) || (domainUse.get(item.destinationDomain) ?? 0) >= 2) continue;
      seen.add(item.destinationUrl);
      domainUse.set(item.destinationDomain, (domainUse.get(item.destinationDomain) ?? 0) + 1);
      result.push(item);
      if (result.length === max) break;
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
  const sampledGroups: Case[][] = [];
  // Always read every Japanese category. Rotation affects presentation only:
  // no category is dropped, and the agent does not choose the categories.
  const focus = args.focus ?? 'balanced';
  const prioritised = LEGACY_FOCUS_ORDER[focus];
  const candidates = [...RSS_FEEDS].sort((a,b) => {
    const posA = prioritised.indexOf(a.id), posB = prioritised.indexOf(b.id);
    return (posA < 0 ? 999 : posA) - (posB < 0 ? 999 : posB);
  });
  const offset = (args.rotation ?? 0) % candidates.length;
  const feeds = [...candidates.slice(offset), ...candidates.slice(0, offset)];
  const fetchedFeeds = await Promise.all(feeds.map(async feed => {
    try {
      return { feed, parsed: parseHatenaDistributionRss(await loadText(feed.url, 8000), feed, now, maxAgeDays), error: null as string | null };
    } catch (e) {
      return {feed, parsed: [] as Case[], error:e instanceof Error ? e.message.slice(0,120) : 'source_failed'};
    }
  }));
  for (const result of fetchedFeeds) {
    health.push({ sourceId:result.feed.id, status:result.error ? 'unavailable' : result.parsed.length ? 'observed' : 'empty',
      url:result.feed.url, rawCases:result.parsed.length, ...(result.error ? {warning:result.error} : {}) });
    if (!result.error) {
      sampledGroups.push(result.parsed);
      allGroups.push(result.parsed.filter(x => topicMatches(x.title,args.topic,x.observedTags) && nicheMatches(x,args.niche)));
    }
  }
  // Cross-disciplinary sampling must not silently drop another market based on focus.
  const includeGlobalTech = args.includeGlobalTech ?? true;
  if (includeGlobalTech) {
    let ids: number[] = [];
    try {
      const fetched = await loadJson(HN_STORIES_URL, 8000);
      if (!Array.isArray(fetched)) throw Error('invalid_story_list');
      ids = fetched.filter((v):v is number => Number.isSafeInteger(v) && v > 0).slice(0, 12);
      const items = await Promise.allSettled(ids.map(id => loadJson(HN_ITEM(id), 5000)));
      const parsed = parseHackerNewsDistribution(items.filter((x):x is PromiseFulfilledResult<unknown> => x.status === 'fulfilled').map(x=>x.value as HnItem), now, maxAgeDays);
      health.push({sourceId:'hacker_news_show', status:parsed.length ? 'observed' : 'empty',url:HN_STORIES_URL,rawCases:parsed.length,
        ...(items.some(x=>x.status === 'rejected') ? {warning:'some_items_unavailable'} : {})});
      sampledGroups.push(parsed);
      allGroups.push(parsed.filter(x=>topicMatches(x.title,args.topic,x.observedTags) && nicheMatches(x,args.niche)));
    } catch (e) {
      health.push({sourceId:'hacker_news_show',status:'unavailable',url:HN_STORIES_URL,rawCases:0,
        warning:e instanceof Error ? e.message.slice(0,120) : 'source_failed'});
    }
  }
  const cases = interleave(allGroups, limit);
  // Discover unknown named micro-markets FROM provider labels. Count distinct
  // outbound documents rather than mistaking 9 Hatena feed appearances for 9 independent communities.
  const marketTags = new Map<string,{tag:string; urls:Set<string>; categories:Set<string>; exampleUrl:string; exampleTitle:string}>();
  for (const group of sampledGroups) for (const entry of group) for (const tag of entry.observedTags) {
    const normalized = tag.toLowerCase().normalize('NFKC');
    if (ALL_CONTEXT_NEUTRAL_TAGS.has(normalized)) continue;
    const hit = marketTags.get(normalized);
    if (hit) { hit.urls.add(entry.destinationUrl); hit.categories.add(entry.sourceId); }
    else marketTags.set(normalized,{tag,urls:new Set([entry.destinationUrl]),categories:new Set([entry.sourceId]),exampleUrl:entry.destinationUrl,exampleTitle:entry.title});
  }
  const observedNiches = [...marketTags.values()]
    .sort((a,b)=> b.urls.size-a.urls.size || b.categories.size-a.categories.size || a.tag.localeCompare(b.tag,'ja'))
    .slice(0,60)
    .map(v=>({name:v.tag,distinctLinkedPages:v.urls.size,observedFeedCategories:[...v.categories],
      exampleUrl:v.exampleUrl,exampleTitle:v.exampleTitle,evidenceType:'rss_dc_subject' as const}));
  const tagCounts = new Map<string,{tag:string,count:number,sourceIds:Set<string>,exampleUrl:string}>();
  for (const group of allGroups) for (const entry of group) {
    for (const tag of entry.observedTags) {
      if (ALL_CONTEXT_NEUTRAL_TAGS.has(tag.toLowerCase().normalize('NFKC'))) continue;
      const key = tag.toLowerCase().normalize('NFKC');
      const existing = tagCounts.get(key);
      if (existing) { existing.count++; existing.sourceIds.add(entry.sourceId); }
      else tagCounts.set(key,{tag,count:1,sourceIds:new Set([entry.sourceId]),exampleUrl:entry.destinationUrl});
    }
  }
  const observedCommunityTags = [...tagCounts.values()]
    .sort((a,b)=>b.count-a.count||a.tag.localeCompare(b.tag,'ja')).slice(0,32)
    .map(v=>({tag:v.tag,entryOccurrences:v.count,observedInFeedCategories:[...v.sourceIds],exampleUrl:v.exampleUrl,evidenceType:'rss_dc_subject'}));
  const domainCounts = new Map<string,number>();
  const urlMentions = new Map<string,Set<string>>();
  const urlOccurrences = new Map<string,number>();
  const urlPlatforms = new Map<string,Set<string>>();
  for (const group of allGroups) for (const item of group) {
    domainCounts.set(item.destinationDomain,(domainCounts.get(item.destinationDomain)||0)+1);
    if (!urlMentions.has(item.destinationUrl)) urlMentions.set(item.destinationUrl,new Set());
    urlMentions.get(item.destinationUrl)!.add(item.sourceId);
    if (!urlPlatforms.has(item.destinationUrl)) urlPlatforms.set(item.destinationUrl,new Set());
    urlPlatforms.get(item.destinationUrl)!.add(item.sourcePlatform);
    urlOccurrences.set(item.destinationUrl,(urlOccurrences.get(item.destinationUrl)||0)+1);
  }
  return {
    fetchedAt:new Date(now).toISOString(), topic:args.topic ?? null, focus, niche:args.niche ?? null,
    status:cases.length ? 'observed_real_distribution_edges' : 'insufficient_observations',
    startingPoint:'public_discovery_feed_entries_not_model_named_channels',
    scope:{maxCases:limit, maxAgeDays, requestedSources:health.length,
      maxUpstreamFetches:feeds.length + (includeGlobalTech ? 13 : 0),
      collectionScope:'all_supported_japanese_categories_plus_optional_global_showcase',
      focusIsNonExclusivePresentationPreference:true,
      attemptedFeedCategories:feeds.map(f=>f.id),
      estimatedFirestoreReads:0, estimatedFirestoreWrites:0, estimatedSerpCalls:0},
    sources:health, cases:cases.map(c=>({
      ...c,
      repeatsInSample:urlOccurrences.get(c.destinationUrl) ?? 1,
      observedFeedCategoryIds:[...(urlMentions.get(c.destinationUrl) ?? [])],
      distinctFeedCategoryCount:urlMentions.get(c.destinationUrl)?.size ?? 1,
      distinctPlatformCount:urlPlatforms.get(c.destinationUrl)?.size ?? 1,
      sameDomainEntriesInSample:domainCounts.get(c.destinationDomain) ?? 1,
      headlineFormatClues:headlineFormatClues(c.title),
      publicationMechanism:c.sourceId === 'hacker_news_show' ? 'community_showcase_post' : 'bookmark_aggregation',
      reproducibility:'not_yet_verified', placementEligibility:'not_yet_verified'
    })),
    observedDestinationDomains:[...new Set(cases.map(c=>c.destinationDomain))],
    observedCommunityTags,
    observedNiches,
    nicheCoverage:{matchedCases:cases.length, boundedHotentryScope:true,
      assessment:cases.length ? 'literal_title_or_provider_tag_matches_only' : 'no_observed_match_in_sample',
      nextStepIfEmpty:'Search this exact user-specified niche in other public sources; absence in the currently supported popularity feeds does not mean the market or audience is absent.'},
    nextInvestigation:[
      'Trace the observed source entry to the actual linked destination, then inspect the content, creator and its CTA where publicly available.',
      'Verify whether this venue accepts original submissions or earned editorial pickup, and whether external click-through is enabled and lawful.',
      'Compare with relevant buyers, creation cost, and an attributable UTM/referral experiment before recommending it.',
      'Sample engagement signals (bookmarks, votes, comments) are NOT referral sessions, purchases, or revenue.',
      'Title clues are mechanically matched words, not a review of the landing-page contents or proof of a conversion mechanism.',
      'Observed community tags come only from dc:subject in public RSS, not model-inferred fandom labels; counts are feed entries, not people.',
      'Focus labels are legacy non-exclusive presentation hints, not a fixed taxonomy of discoverable markets.',
      'observedNiches comes from public provider tags in the complete fetched sample before topic/niche filtering; it is evidence of tagged pages, not independent communities or an exhaustive industry list.',
      'Niche matching is literal and bounded to this popularity-selected sample; an empty niche search is NOT evidence that the market or an acquisition channel does not exist.',
      'Multiple Hatena categories are not independent platforms; repeated placement is counted separately from domain frequency.',
      'No posting, promotion, or contact attempt has been made. An unavailable feed is not a market absence signal.'
    ]
  };
}
