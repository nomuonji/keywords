export const MARKET_SENSOR_SOURCE_IDS = ['google_trends', 'tiktok_creative_center', 'hacker_news'] as const;

export type MarketSensorSourceId = (typeof MARKET_SENSOR_SOURCE_IDS)[number];

export interface MarketSignalObservation {
  source: MarketSensorSourceId;
  rank: number;
  label: string;
  url: string | null;
  category: string | null;
  observedAt: string | null;
  metrics: Record<string, number | string | boolean | null>;
  related: string[];
}

export interface MarketSensorSourceResult {
  source: MarketSensorSourceId;
  url: string;
  signalKind: string[];
  observations: MarketSignalObservation[];
  warnings: string[];
}

export interface MarketSignalScanInput {
  sources?: MarketSensorSourceId[];
  query?: string;
  geo?: string;
  limit?: number;
  tiktokPeriodDays?: 7 | 30 | 90;
  hackerNewsFeed?: 'top' | 'new' | 'best';
}

export interface MarketSignalScanResult {
  fetchedAt: string;
  geo: string;
  sourcesRequested: MarketSensorSourceId[];
  sourcesSucceeded: MarketSensorSourceId[];
  results: MarketSensorSourceResult[];
  warnings: string[];
  interpretationGuardrails: string[];
}

const REQUEST_TIMEOUT_MS = 12_000;

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function xmlText(fragment: string, tag: string): string | null {
  const pattern = new RegExp('<(?:[a-z]+:)?' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z]+:)?' + tag + '>', 'i');
  const match = fragment.match(pattern);
  if (!match?.[1]) return null;
  return stripTags(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, ''));
}

function compactText(value: string | null): string | null {
  if (!value) return null;
  const normalized = stripTags(value);
  return normalized || null;
}

function parseHumanNumber(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replaceAll(',', '').trim().toUpperCase();
  const match = cleaned.match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMB])?\+?$/);
  if (!match?.[1]) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const multiplier = match[2] === 'K' ? 1_000 : match[2] === 'M' ? 1_000_000 : match[2] === 'B' ? 1_000_000_000 : 1;
  return Math.round(base * multiplier);
}

async function fetchText(url: string, accept: string): Promise<{ text: string; finalUrl: string; contentType: string }> {
  const response = await fetch(url, {
    headers: {
      accept,
      'accept-language': 'ja,en-US;q=0.8,en;q=0.6',
      'user-agent': 'keywords-market-sensor/1.0 (+read-only public market observation)'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' from ' + new URL(url).hostname);
  return {
    text: await response.text(),
    finalUrl: response.url,
    contentType: response.headers.get('content-type') ?? ''
  };
}

export function parseGoogleTrendsRss(xml: string, sourceUrl: string, limit = 20): MarketSignalObservation[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const observations: MarketSignalObservation[] = [];
  for (const item of items.slice(0, Math.max(1, limit))) {
    const title = xmlText(item, 'title');
    if (!title) continue;
    const trafficText = xmlText(item, 'approx_traffic');
    const published = xmlText(item, 'pubDate');
    const link = xmlText(item, 'link');
    const newsTitles = [...item.matchAll(/<(?:ht:)?news_item_title\b[^>]*>([\s\S]*?)<\/(?:ht:)?news_item_title>/gi)]
      .map(match => compactText((match[1] ?? '').replace(/^<!\[CDATA\[|\]\]>$/g, '')))
      .filter((value): value is string => Boolean(value))
      .slice(0, 5);
    observations.push({
      source: 'google_trends',
      rank: observations.length + 1,
      label: title,
      url: link || sourceUrl,
      category: null,
      observedAt: published ? new Date(published).toISOString() : null,
      metrics: {
        approxTrafficText: trafficText,
        approxTraffic: parseHumanNumber(trafficText),
      },
      related: [...new Set(newsTitles)]
    });
  }
  return observations;
}

export function parseTikTokCreativeCenterHtml(html: string, sourceUrl: string, limit = 20): MarketSignalObservation[] {
  const text = stripTags(html);
  const observations: MarketSignalObservation[] = [];
  const pattern = /(?:^|\s)(\d{1,3})\s+#([^\s#]+)\s+(.{0,120}?)\s+([0-9]+(?:\.[0-9]+)?[KMB]?)\s+Posts\s+([0-9]+(?:\.[0-9]+)?[KMB]?)\s+Views(?=\s|$)/gi;

  for (const match of text.matchAll(pattern)) {
    if (observations.length >= limit) break;
    const rank = Number(match[1]);
    const hashtag = match[2]?.trim();
    if (!hashtag || !Number.isFinite(rank)) continue;
    let category = (match[3] ?? '').trim();
    category = category.replace(/^(Hashtag|Rank|Posts\s*&\s*Views|Trends|Creator|Action)\s*/i, '').trim();
    if (category.length > 80) category = category.slice(-80).trim();

    observations.push({
      source: 'tiktok_creative_center',
      rank,
      label: '#' + hashtag,
      url: sourceUrl,
      category: category || null,
      observedAt: null,
      metrics: {
        postsText: match[4] ?? null,
        posts: parseHumanNumber(match[4] ?? null),
        viewsText: match[5] ?? null,
        views: parseHumanNumber(match[5] ?? null),
      },
      related: []
    });
  }

  return observations;
}

interface HackerNewsItem {
  id?: number;
  deleted?: boolean;
  dead?: boolean;
  type?: string;
  by?: string;
  time?: number;
  text?: string;
  parent?: number;
  kids?: number[];
  url?: string;
  score?: number;
  title?: string;
  descendants?: number;
}

async function googleTrends(geo: string, limit: number): Promise<MarketSensorSourceResult> {
  const url = new URL('https://trends.google.com/trending/rss');
  url.searchParams.set('geo', geo);
  const response = await fetchText(url.toString(), 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8');
  const observations = parseGoogleTrendsRss(response.text, response.finalUrl, limit);
  return {
    source: 'google_trends',
    url: response.finalUrl,
    signalKind: ['search_intent', 'attention_spike'],
    observations,
    warnings: observations.length ? [] : ['Google Trends RSS returned no parseable trend items.']
  };
}

async function tiktokCreativeCenter(geo: string, limit: number, periodDays: 7 | 30 | 90): Promise<MarketSensorSourceResult> {
  const urls = [
    'https://ads.tiktok.com/creative/creativeCenter/trends?region=' + encodeURIComponent(geo) + '&period=' + periodDays,
    'https://ads.tiktok.com/creative/creativeCenter/trends/hashtag?period=' + periodDays + '&region=' + encodeURIComponent(geo)
  ];
  const warnings: string[] = [];

  for (const url of urls) {
    try {
      const response = await fetchText(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8');
      const observations = parseTikTokCreativeCenterHtml(response.text, response.finalUrl, limit);
      if (observations.length) {
        return {
          source: 'tiktok_creative_center',
          url: response.finalUrl,
          signalKind: ['social_attention', 'content_creation', 'view_attention'],
          observations,
          warnings
        };
      }
      warnings.push('TikTok page loaded but exposed no parseable server-rendered hashtag rows at ' + url);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    source: 'tiktok_creative_center',
    url: urls[0],
    signalKind: ['social_attention', 'content_creation', 'view_attention'],
    observations: [],
    warnings
  };
}

export function parseHackerNewsAlgolia(raw: unknown, sourceUrl: string, limit = 20): MarketSignalObservation[] {
  const record = raw && typeof raw === 'object' ? raw as { hits?: Array<Record<string, unknown>> } : {};
  const hits = Array.isArray(record.hits) ? record.hits : [];
  return hits.slice(0, limit).flatMap((item, index): MarketSignalObservation[] => {
    const title = typeof item.title === 'string' ? item.title : '';
    if (!title) return [];
    const objectId = typeof item.objectID === 'string' ? item.objectID : '';
    const storyUrl = typeof item.url === 'string' && item.url
      ? item.url
      : objectId ? 'https://news.ycombinator.com/item?id=' + objectId : null;
    const createdAt = typeof item.created_at === 'string' ? item.created_at : null;
    return [{
      source: 'hacker_news',
      rank: index + 1,
      label: title,
      url: storyUrl,
      category: 'story',
      observedAt: createdAt ? new Date(createdAt).toISOString() : null,
      metrics: {
        score: typeof item.points === 'number' ? item.points : null,
        comments: typeof item.num_comments === 'number' ? item.num_comments : null,
        queryMatch: true
      },
      related: []
    }];
  });
}

async function hackerNewsQuery(query: string, limit: number): Promise<MarketSensorSourceResult> {
  const url = new URL('https://hn.algolia.com/api/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('tags', 'story');
  url.searchParams.set('hitsPerPage', String(limit));
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'keywords-market-sensor/1.1' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' from Hacker News Algolia');
  const raw = await response.json();
  const observations = parseHackerNewsAlgolia(raw, url.toString(), limit);
  return {
    source: 'hacker_news',
    url: url.toString(),
    signalKind: ['query_relevant_early_adopter_attention', 'query_relevant_problem_expression'],
    observations,
    warnings: observations.length ? [] : ['Hacker News query search returned no matching stories for "' + query + '".']
  };
}

async function hackerNews(feed: 'top' | 'new' | 'best', limit: number): Promise<MarketSensorSourceResult> {
  const feedUrl = 'https://hacker-news.firebaseio.com/v0/' + feed + 'stories.json';
  const response = await fetch(feedUrl, {
    headers: { accept: 'application/json', 'user-agent': 'keywords-market-sensor/1.0' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' from Hacker News');
  const ids = await response.json() as number[];
  const selected = Array.isArray(ids) ? ids.slice(0, limit) : [];
  const items = await Promise.all(selected.map(async id => {
    try {
      const itemResponse = await fetch('https://hacker-news.firebaseio.com/v0/item/' + id + '.json', {
        headers: { accept: 'application/json', 'user-agent': 'keywords-market-sensor/1.0' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (!itemResponse.ok) return null;
      return await itemResponse.json() as HackerNewsItem;
    } catch {
      return null;
    }
  }));

  const observations = items.flatMap((item, index) => {
    if (!item?.title || item.deleted || item.dead) return [];
    return [{
      source: 'hacker_news' as const,
      rank: index + 1,
      label: item.title,
      url: item.url ?? (item.id ? 'https://news.ycombinator.com/item?id=' + item.id : null),
      category: item.type ?? null,
      observedAt: item.time ? new Date(item.time * 1000).toISOString() : null,
      metrics: {
        score: typeof item.score === 'number' ? item.score : null,
        comments: typeof item.descendants === 'number' ? item.descendants : null,
      },
      related: []
    }];
  });

  return {
    source: 'hacker_news',
    url: feedUrl,
    signalKind: ['early_adopter_attention', 'new_product_expression', 'technical_problem_expression'],
    observations,
    warnings: observations.length < selected.length ? ['Some Hacker News items could not be fetched or were deleted/dead.'] : []
  };
}

export function marketSensorCapabilities() {
  return {
    sources: {
      google_trends: {
        auth: 'none',
        access: 'public_rss',
        signalKind: ['search_intent', 'attention_spike'],
        fields: ['title', 'approxTraffic', 'publishedAt', 'relatedNewsTitles']
      },
      tiktok_creative_center: {
        auth: 'none',
        access: 'public_web_surface',
        signalKind: ['social_attention', 'content_creation', 'view_attention'],
        fields: ['rank', 'hashtag', 'category', 'posts', 'views'],
        note: 'Only server-rendered public rows are observed; the tool does not emulate TikTok private/internal signed APIs.'
      },
      hacker_news: {
        auth: 'none',
        access: 'official_public_firebase_api',
        signalKind: ['early_adopter_attention', 'new_product_expression', 'technical_problem_expression'],
        fields: ['rank', 'title', 'score', 'comments', 'publishedAt', 'url']
      }
    },
    intentionallyDeferred: {
      youtube: 'Official Data API requires a project API key; KEYWORDS deployment currently has no YOUTUBE_API_KEY.',
      meta_ad_library: 'General commercial ad discovery has no stable unauthenticated official API suitable for this MCP contract.'
    }
  };
}

export async function marketSignalScan(input: MarketSignalScanInput = {}): Promise<MarketSignalScanResult> {
  const sources = [...new Set(input.sources?.length ? input.sources : MARKET_SENSOR_SOURCE_IDS)];
  const geo = (input.geo ?? 'JP').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(geo)) throw new Error('geo must be a two-letter country code.');
  const limit = Math.max(1, Math.min(input.limit ?? 10, 20));
  const tiktokPeriodDays = input.tiktokPeriodDays ?? 7;
  const hackerNewsFeed = input.hackerNewsFeed ?? 'top';
  const query = input.query?.trim() || null;
  const warnings: string[] = [];
  const settled = await Promise.all(sources.map(async source => {
    try {
      if (source === 'google_trends') return await googleTrends(geo, limit);
      if (source === 'tiktok_creative_center') return await tiktokCreativeCenter(geo, limit, tiktokPeriodDays);
      if (source === 'hacker_news') return query ? await hackerNewsQuery(query, limit) : await hackerNews(hackerNewsFeed, limit);
      return null;
    } catch (error) {
      warnings.push(source + ': ' + (error instanceof Error ? error.message : String(error)));
      return null;
    }
  }));
  const results = settled.filter((result): result is MarketSensorSourceResult => Boolean(result));

  return {
    fetchedAt: new Date().toISOString(),
    geo,
    sourcesRequested: sources,
    sourcesSucceeded: results.filter(result => result.observations.length > 0).map(result => result.source),
    results,
    warnings,
    interpretationGuardrails: [
      'These are observations, not product recommendations.',
      'Do not infer sales or willingness to pay from search traffic, views, posts, HN score, or comments.',
      'Look for repeated behavior/desire across independent sources before forming a market thesis.',
      'Preserve source disagreement and missing evidence; do not collapse these signals into one opportunity score.',
      'TikTok Creative Center observations are limited to public server-rendered rows and may be fewer than the requested limit.',
      ...(query ? ['When query is supplied, Hacker News switches to query relevance search. Google Trends/TikTok broad surfaces are not automatically treated as query evidence.'] : [])
    ]
  };
}
