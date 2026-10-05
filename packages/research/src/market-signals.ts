export const MARKET_SIGNAL_SOURCE_IDS = ['steam', 'app_store', 'hacker_news'] as const;

export type MarketSignalSourceId = (typeof MARKET_SIGNAL_SOURCE_IDS)[number];
export type MarketSignalMode = 'search' | 'discover';

export interface MarketSignalResearchInput {
  mode?: MarketSignalMode;
  query?: string;
  sources?: MarketSignalSourceId[];
  limit?: number;
  country?: string;
  steamView?: 'popular_new' | 'global_top_sellers';
  hnWindowDays?: number;
  enrichSteamReviews?: boolean;
}

export interface MarketSignalView {
  name: string;
  url: string;
  totalCount: number | null;
  observations: Array<Record<string, unknown>>;
  metrics: Record<string, unknown>;
}

export interface MarketSignalSourceResult {
  source: MarketSignalSourceId;
  signalKinds: string[];
  views: MarketSignalView[];
  warnings: string[];
}

export interface MarketSignalResearchResult {
  mode: MarketSignalMode;
  query: string | null;
  fetchedAt: string;
  sourcesRequested: MarketSignalSourceId[];
  sourcesSucceeded: MarketSignalSourceId[];
  results: MarketSignalSourceResult[];
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
  return decodeHtml(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function extractAttr(fragment: string, name: string): string | null {
  const doubleQuoted = fragment.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i'));
  if (doubleQuoted?.[1] !== undefined) return decodeHtml(doubleQuoted[1]);
  const singleQuoted = fragment.match(new RegExp(name + "\\s*=\\s*'([^']*)'", 'i'));
  if (singleQuoted?.[1] !== undefined) return decodeHtml(singleQuoted[1]);
  return null;
}

function classText(fragment: string, className: string): string | null {
  const expression = new RegExp(
    "<[^>]+class=[\"'][^\"']*" + className + "[^\"']*[\"'][^>]*>([\\s\\S]*?)<\\/[^>]+>",
    'i'
  );
  const match = fragment.match(expression);
  return match?.[1] ? stripTags(match[1]) : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function boundedFetch(url: URL, allowedHosts: string[]): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.8,ja;q=0.5',
      'user-agent': 'keywords-real-market-signals/0.1 (+read-only market research)'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const finalHost = new URL(response.url).hostname.toLowerCase();
  if (!allowedHosts.some(host => finalHost === host || finalHost.endsWith('.' + host))) {
    throw new Error('Request redirected outside allowed market-data hosts.');
  }
  if (!response.ok) throw new Error('Market-data request failed with HTTP ' + response.status + '.');
  return response;
}

function currencyForCountry(country: string): string | null {
  const map: Record<string, string> = { US: 'USD', JP: 'JPY', GB: 'GBP', CA: 'CAD', AU: 'AUD', DE: 'EUR', FR: 'EUR' };
  return map[country.toUpperCase()] ?? null;
}

function steamResultCount(html: string): number | null {
  const match = html.match(/([0-9,]+)\s+results match your search/i);
  return match?.[1] ? Number.parseInt(match[1].replaceAll(',', ''), 10) : null;
}

export function parseSteamSearchHtml(
  html: string,
  input: { url: string; limit: number; country: string }
): Omit<MarketSignalView, 'metrics'> {
  const observations: Array<Record<string, unknown>> = [];
  const cardPattern = /<a\b[^>]*class=["'][^"']*search_result_row[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
  let rank = 0;

  for (const match of html.matchAll(cardPattern)) {
    if (observations.length >= input.limit) break;
    const card = match[0];
    const openingTag = card.match(/^<a\b[^>]*>/i)?.[0] ?? '';
    const href = extractAttr(openingTag, 'href') ?? '';
    const appId = extractAttr(openingTag, 'data-ds-appid') ?? href.match(/\/app\/([0-9]+)/i)?.[1] ?? null;
    const title = classText(card, 'title');
    if (!appId || !title) continue;
    rank += 1;

    const priceBlock = card.match(/<div\b[^>]*class=["'][^"']*(?:discount_block|search_price_discount_combined)[^"']*["'][^>]*>[\s\S]*?<\/div>/i)?.[0] ?? card;
    const priceMinorRaw = extractAttr(priceBlock, 'data-price-final') ?? extractAttr(card, 'data-price-final');
    const priceMinor = priceMinorRaw === null ? null : finiteNumber(priceMinorRaw);
    const priceText = classText(card, 'discount_final_price') ?? classText(card, 'search_price') ?? null;
    const discountText = classText(card, 'discount_pct');
    const discountPercentMatch = discountText?.match(/-?([0-9]+)%/);
    const discountPercent = discountPercentMatch?.[1] ? Number.parseInt(discountPercentMatch[1], 10) : 0;

    const reviewTag = card.match(/<span\b[^>]*class=["'][^"']*search_review_summary[^"']*["'][^>]*>/i)?.[0] ?? '';
    const reviewTooltip = extractAttr(reviewTag, 'data-tooltip-html');
    const tooltipText = reviewTooltip ? stripTags(reviewTooltip) : null;
    const tooltipPercent = tooltipText?.match(/([0-9]+)%/);
    const tooltipCount = tooltipText?.match(/(?:the|of)\s+([0-9,]+)\s+(?:user\s+)?reviews?/i);

    observations.push({
      rank,
      id: appId,
      title,
      url: href ? new URL(href, 'https://store.steampowered.com').toString() : 'https://store.steampowered.com/app/' + appId,
      releaseDate: classText(card, 'search_released'),
      priceMinor,
      price: priceMinor === null ? null : priceMinor / 100,
      priceText: priceText ? stripTags(priceText) : null,
      currency: currencyForCountry(input.country),
      discountPercent,
      reviewSummaryText: tooltipText,
      reviewCount: tooltipCount?.[1] ? Number.parseInt(tooltipCount[1].replaceAll(',', ''), 10) : null,
      positiveRate: tooltipPercent?.[1] ? Number.parseInt(tooltipPercent[1], 10) / 100 : null
    });
  }

  return {
    name: 'steam',
    url: input.url,
    totalCount: steamResultCount(html),
    observations
  };
}

async function steamReviewSummary(appId: string): Promise<Record<string, unknown> | null> {
  const url = new URL('/appreviews/' + encodeURIComponent(appId), 'https://store.steampowered.com');
  url.searchParams.set('json', '1');
  url.searchParams.set('language', 'all');
  url.searchParams.set('purchase_type', 'all');
  url.searchParams.set('review_type', 'all');
  url.searchParams.set('num_per_page', '0');
  try {
    const response = await boundedFetch(url, ['store.steampowered.com']);
    const raw = await response.json() as { success?: number; query_summary?: Record<string, unknown> };
    if (raw.success !== 1 || !raw.query_summary) return null;
    const totalPositive = finiteNumber(raw.query_summary.total_positive);
    const totalNegative = finiteNumber(raw.query_summary.total_negative);
    const totalReviews = finiteNumber(raw.query_summary.total_reviews);
    return {
      reviewScore: finiteNumber(raw.query_summary.review_score),
      reviewScoreDesc: typeof raw.query_summary.review_score_desc === 'string' ? raw.query_summary.review_score_desc : null,
      totalPositive,
      totalNegative,
      totalReviews,
      positiveRate: totalReviews && totalPositive !== null ? totalPositive / totalReviews : null
    };
  } catch {
    return null;
  }
}

function steamMetrics(observations: Array<Record<string, unknown>>): Record<string, unknown> {
  const prices = observations.map(item => finiteNumber(item.price)).filter((value): value is number => value !== null);
  const reviewCounts = observations.map(item => finiteNumber(item.reviewCount)).filter((value): value is number => value !== null);
  const paidCount = observations.filter(item => (finiteNumber(item.price) ?? 0) > 0).length;
  return {
    observedProductCount: observations.length,
    paidProductCount: paidCount,
    medianObservedPrice: median(prices),
    reviewCountObservedProducts: reviewCounts.length,
    medianObservedReviewCount: median(reviewCounts)
  };
}

async function steamResearch(input: Required<Pick<MarketSignalResearchInput, 'mode' | 'limit' | 'country' | 'steamView' | 'enrichSteamReviews'>> & { query: string | null }): Promise<MarketSignalSourceResult> {
  const warnings: string[] = [];
  const url = new URL('/search/', 'https://store.steampowered.com');
  url.searchParams.set('ignore_preferences', '1');
  url.searchParams.set('ndl', '1');
  url.searchParams.set('cc', input.country.toUpperCase());
  url.searchParams.set('l', 'english');
  if (input.mode === 'search') {
    url.searchParams.set('term', input.query ?? '');
  } else {
    url.searchParams.set('filter', input.steamView === 'global_top_sellers' ? 'globaltopsellers' : 'popularnew');
  }

  const response = await boundedFetch(url, ['store.steampowered.com']);
  const html = await response.text();
  const parsed = parseSteamSearchHtml(html, { url: url.toString(), limit: input.limit, country: input.country });
  let observations = parsed.observations;

  if (input.enrichSteamReviews) {
    const enriched: Array<Record<string, unknown>> = [];
    for (const observation of observations) {
      const id = String(observation.id ?? '');
      const summary = id ? await steamReviewSummary(id) : null;
      if (!summary) {
        enriched.push(observation);
        continue;
      }
      enriched.push({
        ...observation,
        reviewCount: summary.totalReviews ?? observation.reviewCount ?? null,
        positiveRate: summary.positiveRate ?? observation.positiveRate ?? null,
        reviewScore: summary.reviewScore,
        reviewScoreDesc: summary.reviewScoreDesc,
        totalPositive: summary.totalPositive,
        totalNegative: summary.totalNegative
      });
    }
    observations = enriched;
  }

  return {
    source: 'steam',
    signalKinds: ['commercial_adoption_proxy', 'consumer_attention'],
    views: [{
      ...parsed,
      name: input.mode === 'search' ? 'keyword_search' : input.steamView,
      observations,
      metrics: steamMetrics(observations)
    }],
    warnings
  };
}

interface AppStoreRawItem {
  trackId?: number;
  trackName?: string;
  trackViewUrl?: string;
  sellerName?: string;
  primaryGenreName?: string;
  genres?: string[];
  price?: number;
  formattedPrice?: string;
  currency?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  averageUserRatingForCurrentVersion?: number;
  userRatingCountForCurrentVersion?: number;
  releaseDate?: string;
  currentVersionReleaseDate?: string;
  version?: string;
  minimumOsVersion?: string;
  description?: string;
}

async function appStoreResearch(input: { mode: MarketSignalMode; query: string | null; limit: number; country: string }): Promise<MarketSignalSourceResult> {
  if (input.mode === 'discover') {
    return {
      source: 'app_store',
      signalKinds: ['commercial_adoption_proxy', 'consumer_attention'],
      views: [],
      warnings: ['Apple Search API is keyword-oriented; app_store is skipped in discover mode until a stable official chart feed is configured.']
    };
  }
  const url = new URL('/search', 'https://itunes.apple.com');
  url.searchParams.set('term', input.query ?? '');
  url.searchParams.set('country', input.country.toLowerCase());
  url.searchParams.set('entity', 'software');
  url.searchParams.set('limit', String(input.limit));
  const response = await boundedFetch(url, ['itunes.apple.com']);
  const raw = await response.json() as { resultCount?: number; results?: AppStoreRawItem[] };
  const observations = (raw.results ?? []).slice(0, input.limit).map((item, index) => ({
    rank: index + 1,
    id: item.trackId ?? null,
    title: item.trackName ?? null,
    url: item.trackViewUrl ?? null,
    sellerName: item.sellerName ?? null,
    primaryGenre: item.primaryGenreName ?? null,
    genres: item.genres ?? [],
    price: finiteNumber(item.price),
    formattedPrice: item.formattedPrice ?? null,
    currency: item.currency ?? null,
    rating: finiteNumber(item.averageUserRating),
    ratingCount: finiteNumber(item.userRatingCount),
    currentVersionRating: finiteNumber(item.averageUserRatingForCurrentVersion),
    currentVersionRatingCount: finiteNumber(item.userRatingCountForCurrentVersion),
    releaseDate: item.releaseDate ?? null,
    currentVersionReleaseDate: item.currentVersionReleaseDate ?? null,
    version: item.version ?? null,
    minimumOsVersion: item.minimumOsVersion ?? null,
    descriptionExcerpt: item.description ? item.description.replace(/\s+/g, ' ').trim().slice(0, 600) : null
  }));
  const prices = observations.map(item => finiteNumber(item.price)).filter((value): value is number => value !== null);
  const ratings = observations.map(item => finiteNumber(item.rating)).filter((value): value is number => value !== null);
  const ratingCounts = observations.map(item => finiteNumber(item.ratingCount)).filter((value): value is number => value !== null);

  return {
    source: 'app_store',
    signalKinds: ['commercial_adoption_proxy', 'consumer_attention'],
    views: [{
      name: 'keyword_search',
      url: url.toString(),
      totalCount: finiteNumber(raw.resultCount),
      observations,
      metrics: {
        observedAppCount: observations.length,
        paidAppCount: observations.filter(item => (finiteNumber(item.price) ?? 0) > 0).length,
        medianObservedPrice: median(prices),
        medianObservedRating: median(ratings),
        medianObservedRatingCount: median(ratingCounts)
      }
    }],
    warnings: []
  };
}

interface HnHit {
  objectID?: string;
  title?: string | null;
  story_title?: string | null;
  url?: string | null;
  story_url?: string | null;
  author?: string;
  points?: number | null;
  num_comments?: number | null;
  created_at?: string;
  created_at_i?: number;
  story_text?: string | null;
  comment_text?: string | null;
  _tags?: string[];
}

async function hnView(name: string, url: URL): Promise<MarketSignalView> {
  const response = await boundedFetch(url, ['hn.algolia.com']);
  const raw = await response.json() as { nbHits?: number; hits?: HnHit[] };
  const observations = (raw.hits ?? []).map((hit, index) => ({
    rank: index + 1,
    id: hit.objectID ?? null,
    title: hit.title ?? hit.story_title ?? null,
    url: hit.url ?? hit.story_url ?? (hit.objectID ? 'https://news.ycombinator.com/item?id=' + hit.objectID : null),
    discussionUrl: hit.objectID ? 'https://news.ycombinator.com/item?id=' + hit.objectID : null,
    author: hit.author ?? null,
    points: finiteNumber(hit.points),
    comments: finiteNumber(hit.num_comments),
    createdAt: hit.created_at ?? null,
    tags: hit._tags ?? [],
    textExcerpt: stripTags(hit.story_text ?? hit.comment_text ?? '').slice(0, 800) || null
  }));
  const points = observations.map(item => finiteNumber(item.points)).filter((value): value is number => value !== null);
  const comments = observations.map(item => finiteNumber(item.comments)).filter((value): value is number => value !== null);
  return {
    name,
    url: url.toString(),
    totalCount: finiteNumber(raw.nbHits),
    observations,
    metrics: {
      observedItemCount: observations.length,
      medianPoints: median(points),
      medianComments: median(comments),
      maxPoints: points.length ? Math.max(...points) : null,
      maxComments: comments.length ? Math.max(...comments) : null
    }
  };
}

async function hackerNewsResearch(input: { mode: MarketSignalMode; query: string | null; limit: number; hnWindowDays: number }): Promise<MarketSignalSourceResult> {
  const views: MarketSignalView[] = [];
  const cutoff = Math.floor(Date.now() / 1000) - input.hnWindowDays * 86400;

  if (input.mode === 'search') {
    const relevant = new URL('/api/v1/search', 'https://hn.algolia.com');
    relevant.searchParams.set('query', input.query ?? '');
    relevant.searchParams.set('tags', 'story');
    relevant.searchParams.set('hitsPerPage', String(input.limit));
    views.push(await hnView('relevance', relevant));

    const recent = new URL('/api/v1/search_by_date', 'https://hn.algolia.com');
    recent.searchParams.set('query', input.query ?? '');
    recent.searchParams.set('tags', 'story');
    recent.searchParams.set('numericFilters', 'created_at_i>' + cutoff);
    recent.searchParams.set('hitsPerPage', String(input.limit));
    views.push(await hnView('recent', recent));
  } else {
    const front = new URL('/api/v1/search', 'https://hn.algolia.com');
    front.searchParams.set('tags', 'front_page');
    front.searchParams.set('hitsPerPage', String(input.limit));
    views.push(await hnView('front_page', front));

    for (const [name, tag] of [['show_hn_recent', 'show_hn'], ['ask_hn_recent', 'ask_hn']] as const) {
      const recent = new URL('/api/v1/search_by_date', 'https://hn.algolia.com');
      recent.searchParams.set('tags', tag);
      recent.searchParams.set('numericFilters', 'created_at_i>' + cutoff);
      recent.searchParams.set('hitsPerPage', String(input.limit));
      views.push(await hnView(name, recent));
    }
  }

  return {
    source: 'hacker_news',
    signalKinds: ['attention', 'problem_expression', 'new_product_expression'],
    views,
    warnings: []
  };
}

export function marketSignalSourceCapabilities(): Record<MarketSignalSourceId, Record<string, unknown>> {
  return {
    steam: {
      modes: ['search', 'discover'],
      discoveryViews: ['popular_new', 'global_top_sellers'],
      signalKinds: ['commercial_adoption_proxy', 'consumer_attention'],
      structuredFields: ['price', 'releaseDate', 'reviewCount', 'positiveRate']
    },
    app_store: {
      modes: ['search'],
      signalKinds: ['commercial_adoption_proxy', 'consumer_attention'],
      structuredFields: ['price', 'rating', 'ratingCount', 'releaseDate', 'currentVersionReleaseDate', 'genre']
    },
    hacker_news: {
      modes: ['search', 'discover'],
      discoveryViews: ['front_page', 'show_hn_recent', 'ask_hn_recent'],
      signalKinds: ['attention', 'problem_expression', 'new_product_expression'],
      structuredFields: ['points', 'comments', 'createdAt', 'title', 'url']
    }
  };
}

export async function marketSignalResearch(input: MarketSignalResearchInput = {}): Promise<MarketSignalResearchResult> {
  const mode = input.mode ?? (input.query?.trim() ? 'search' : 'discover');
  const query = input.query?.trim() || null;
  if (mode === 'search' && !query) throw new Error('query is required in search mode.');

  const sources = [...new Set(input.sources?.length ? input.sources : MARKET_SIGNAL_SOURCE_IDS)];
  const limit = Math.max(1, Math.min(input.limit ?? 10, 20));
  const country = (input.country ?? 'US').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('country must be a two-letter country code.');
  const steamView = input.steamView ?? 'popular_new';
  const hnWindowDays = Math.max(1, Math.min(input.hnWindowDays ?? 30, 365));
  const enrichSteamReviews = input.enrichSteamReviews ?? true;
  const results: MarketSignalSourceResult[] = [];
  const warnings: string[] = [];

  for (const source of sources) {
    try {
      if (source === 'steam') {
        results.push(await steamResearch({ mode, query, limit, country, steamView, enrichSteamReviews }));
      } else if (source === 'app_store') {
        results.push(await appStoreResearch({ mode, query, limit, country }));
      } else if (source === 'hacker_news') {
        results.push(await hackerNewsResearch({ mode, query, limit, hnWindowDays }));
      }
    } catch (error) {
      warnings.push(source + ': ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  return {
    mode,
    query,
    fetchedAt: new Date().toISOString(),
    sourcesRequested: sources,
    sourcesSucceeded: results.filter(result => result.views.length > 0).map(result => result.source),
    results,
    warnings,
    interpretationGuardrails: [
      'Do not infer unit sales or revenue from review counts, ratings, rankings, points, or comments.',
      'Steam review counts and App Store rating counts are adoption/engagement proxies; free products can also accumulate them.',
      'Hacker News points/comments measure attention and discussion, not willingness to pay.',
      'Start ideation only after identifying a repeated behavior/desire across observed evidence; do not turn one popular item into a product recommendation.',
      'Preserve source-specific evidence and disagreements instead of collapsing all signals into one opportunity score.'
    ]
  };
}
