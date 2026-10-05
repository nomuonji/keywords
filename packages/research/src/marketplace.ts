export const MARKETPLACE_ADAPTER_IDS = ['booth'] as const;

export type MarketplaceAdapterId = (typeof MARKETPLACE_ADAPTER_IDS)[number];
export type MarketplaceSort = 'popularity' | 'wish_lists' | 'new';

export interface MarketplaceProduct {
  id: string;
  title: string;
  url: string;
  shopName: string | null;
  shopUrl: string | null;
  price: number | null;
  currency: string | null;
  likes: number | null;
  categoryId: string | null;
  brand: string | null;
  imageUrl: string | null;
  isAdult: boolean;
}

export interface MarketplaceViewMetrics {
  observedProductCount: number;
  pricedProductCount: number;
  medianPrice: number | null;
  likedProductCount: number;
  medianLikes: number | null;
  uniqueShopCount: number;
  topShopObservedShare: number | null;
  observedCategoryCounts: Array<{ categoryId: string; count: number }>;
}

export interface MarketplaceSearchView {
  sort: string;
  url: string;
  resultCount: number;
  totalPages: number;
  relatedTags: string[];
  products: MarketplaceProduct[];
  metrics: MarketplaceViewMetrics;
}

export interface MarketplaceViewOverlap {
  leftSort: string;
  rightSort: string;
  overlapCount: number;
  smallerViewCount: number;
  overlapRate: number | null;
}

export interface MarketplaceResearchResult {
  marketplace: string;
  query: string;
  fetchedAt: string;
  capabilities: {
    suggestions: boolean;
    resultCount: boolean;
    productCards: boolean;
    likes: boolean;
    supportedSorts: string[];
  };
  suggestions: string[];
  views: MarketplaceSearchView[];
  comparison: {
    overlaps: MarketplaceViewOverlap[];
  };
  warnings: string[];
}

export interface MarketplaceResearchInput {
  marketplace?: string;
  query: string;
  page?: number;
  sorts?: MarketplaceSort[];
  includeSuggestions?: boolean;
  maxProducts?: number;
}

export interface MarketplaceAdapter {
  id: string;
  capabilities: MarketplaceResearchResult['capabilities'];
  research(input: MarketplaceResearchInput): Promise<MarketplaceResearchResult>;
}

const BOOTH_BASE_URL = 'https://booth.pm';
const BOOTH_WISHLIST_URL = 'https://accounts.booth.pm/wish_lists.json';
const REQUEST_TIMEOUT_MS = 12_000;
const BOOTH_PAGE_SIZE = 60;

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
    '<[^>]+class=["\\'][^"\\']*' + className + '[^"\\']*["\\'][^>]*>([\\s\\S]*?)<\\/[^>]+>',
    'i'
  );
  const match = fragment.match(expression);
  return match?.[1] ? stripTags(match[1]) : null;
}

function classAttr(fragment: string, className: string, attrName: string): string | null {
  const expression = new RegExp(
    '<[^>]+class=["\\'][^"\\']*' + className + '[^"\\']*["\\'][^>]*>',
    'i'
  );
  const match = fragment.match(expression);
  return match?.[0] ? extractAttr(match[0], attrName) : null;
}

function metaDescription(html: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const key = (extractAttr(tag, 'name') ?? extractAttr(tag, 'property') ?? '').toLowerCase();
    if (key === 'description' || key === 'og:description') {
      const content = extractAttr(tag, 'content');
      if (content) return content;
    }
  }
  return null;
}

function relatedTagsFromDescription(description: string | null): string[] {
  if (!description) return [];
  const match = description.match(/関連する商品のタグには、(.+?)などがあります/);
  if (!match?.[1]) return [];
  return [...new Set(match[1].split('、').map(value => value.trim()).filter(Boolean))].slice(0, 20);
}

function resultCountFromHtml(html: string, description: string | null): number {
  const patterns = [
    /対象商品\s*([0-9,]+)\s*件/,
    /<b[^>]*>\s*(?:Results?\s*)?([0-9,]+)\s*件\s*<\/b>/i,
    /通販・ダウンロード商品は\s*([0-9,]+)\s*件/
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern) ?? description?.match(pattern);
    if (match?.[1]) return Number.parseInt(match[1].replaceAll(',', ''), 10) || 0;
  }
  return 0;
}

function normalizeUrl(value: string | null, base = BOOTH_BASE_URL): string | null {
  if (!value) return null;
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

export function parseBoothSearchHtml(
  html: string,
  input: { query: string; sort: MarketplaceSort; url: string; maxProducts?: number }
): Omit<MarketplaceSearchView, 'metrics'> {
  if (/class=["'][^"']*js-approve-adult/i.test(html)) {
    throw new Error('BOOTH search returned an age-verification wall; adult-only research is not supported.');
  }

  const description = metaDescription(html);
  const relatedTags = relatedTagsFromDescription(description);
  const resultCount = resultCountFromHtml(html, description);
  const maxProducts = Math.max(1, Math.min(input.maxProducts ?? 20, BOOTH_PAGE_SIZE));
  const products: MarketplaceProduct[] = [];
  const cardPattern = /<li\b[^>]*data-product-id=["'][0-9]+["'][^>]*>[\s\S]*?<\/li>/gi;

  for (const match of html.matchAll(cardPattern)) {
    if (products.length >= maxProducts) break;
    const card = match[0];
    const openingTag = card.match(/^<li\b[^>]*>/i)?.[0] ?? '';
    const id = extractAttr(openingTag, 'data-product-id');
    if (!id) continue;

    const title = classText(card, 'item-card__title-anchor--multiline') ?? '';
    const shopName = classText(card, 'item-card__shop-name');
    const shopUrl = normalizeUrl(classAttr(card, 'item-card__shop-name-anchor', 'href'));
    const imageUrl = normalizeUrl(classAttr(card, 'js-thumbnail-image', 'data-original'));
    const rawPrice = extractAttr(openingTag, 'data-product-price');
    const parsedPrice = rawPrice === null ? null : Number(rawPrice);
    const productUrl = BOOTH_BASE_URL + '/ja/items/' + encodeURIComponent(id);

    products.push({
      id,
      title,
      url: productUrl,
      shopName,
      shopUrl,
      price: Number.isFinite(parsedPrice) ? parsedPrice : null,
      currency: 'JPY',
      likes: null,
      categoryId: extractAttr(openingTag, 'data-product-category'),
      brand: extractAttr(openingTag, 'data-product-brand'),
      imageUrl,
      isAdult: /class=["'][^"']*badge[^"']*adult|class=["'][^"']*adult[^"']*badge/i.test(card)
    });
  }

  return {
    sort: input.sort,
    url: input.url,
    resultCount: resultCount || products.length,
    totalPages: resultCount > 0 ? Math.ceil(resultCount / BOOTH_PAGE_SIZE) : (products.length > 0 ? 1 : 0),
    relatedTags,
    products
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function metricsForProducts(products: MarketplaceProduct[]): MarketplaceViewMetrics {
  const prices = products.flatMap(product => product.price === null ? [] : [product.price]);
  const likes = products.flatMap(product => product.likes === null ? [] : [product.likes]);
  const shops = new Map<string, number>();
  const categories = new Map<string, number>();

  for (const product of products) {
    const shopKey = product.shopUrl ?? product.shopName;
    if (shopKey) shops.set(shopKey, (shops.get(shopKey) ?? 0) + 1);
    if (product.categoryId) categories.set(product.categoryId, (categories.get(product.categoryId) ?? 0) + 1);
  }

  const topShopCount = shops.size > 0 ? Math.max(...shops.values()) : 0;
  return {
    observedProductCount: products.length,
    pricedProductCount: prices.length,
    medianPrice: median(prices),
    likedProductCount: likes.length,
    medianLikes: median(likes),
    uniqueShopCount: shops.size,
    topShopObservedShare: products.length > 0 ? topShopCount / products.length : null,
    observedCategoryCounts: [...categories.entries()]
      .map(([categoryId, count]) => ({ categoryId, count }))
      .sort((left, right) => right.count - left.count || left.categoryId.localeCompare(right.categoryId))
  };
}

function buildOverlap(views: MarketplaceSearchView[]): MarketplaceViewOverlap[] {
  const overlaps: MarketplaceViewOverlap[] = [];
  for (let leftIndex = 0; leftIndex < views.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < views.length; rightIndex += 1) {
      const left = views[leftIndex];
      const right = views[rightIndex];
      const leftIds = new Set(left.products.map(product => product.id));
      const rightIds = new Set(right.products.map(product => product.id));
      const overlapCount = [...leftIds].filter(id => rightIds.has(id)).length;
      const smallerViewCount = Math.min(leftIds.size, rightIds.size);
      overlaps.push({
        leftSort: left.sort,
        rightSort: right.sort,
        overlapCount,
        smallerViewCount,
        overlapRate: smallerViewCount > 0 ? overlapCount / smallerViewCount : null
      });
    }
  }
  return overlaps;
}

async function boothFetch(url: URL): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'ja,en;q=0.7',
      'user-agent': 'keywords-marketplace-research/0.1 (+read-only market research)'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const finalHost = new URL(response.url).hostname.toLowerCase();
  if (finalHost !== 'booth.pm' && !finalHost.endsWith('.booth.pm')) {
    throw new Error('BOOTH request redirected outside booth.pm.');
  }
  if (!response.ok) {
    throw new Error('BOOTH request failed with HTTP ' + response.status + '.');
  }
  return response;
}

async function boothSuggestions(query: string): Promise<string[]> {
  const url = new URL('/autocomplete/tag.json', BOOTH_BASE_URL);
  url.searchParams.set('term', query);
  const response = await boothFetch(url);
  const raw = await response.json() as unknown;
  if (!Array.isArray(raw)) return [];
  const values = raw.flatMap(item => {
    if (typeof item === 'string') return [item];
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    for (const key of ['value', 'label', 'name', 'text']) {
      if (typeof record[key] === 'string') return [record[key] as string];
    }
    return [];
  });
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, 50);
}

async function boothWishlistCounts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const url = new URL(BOOTH_WISHLIST_URL);
  for (const id of ids.slice(0, BOOTH_PAGE_SIZE)) url.searchParams.append('item_ids[]', id);
  try {
    const response = await boothFetch(url);
    const raw = await response.json() as { wishlists_counts?: Record<string, unknown> };
    const result = new Map<string, number>();
    for (const [id, value] of Object.entries(raw.wishlists_counts ?? {})) {
      const count = Number(value);
      if (Number.isFinite(count)) result.set(id, count);
    }
    return result;
  } catch {
    return new Map();
  }
}

const boothAdapter: MarketplaceAdapter = {
  id: 'booth',
  capabilities: {
    suggestions: true,
    resultCount: true,
    productCards: true,
    likes: true,
    supportedSorts: ['popularity', 'wish_lists', 'new']
  },
  async research(input) {
    const query = input.query.trim();
    if (!query) throw new Error('query is required.');
    const page = Math.max(1, Math.min(input.page ?? 1, 10));
    const requestedSorts = input.sorts?.length ? input.sorts : ['popularity'];
    const sorts = [...new Set(requestedSorts)].slice(0, 3);
    const includeSuggestions = input.includeSuggestions ?? true;
    const warnings: string[] = [];
    let suggestions: string[] = [];

    if (includeSuggestions) {
      try {
        suggestions = await boothSuggestions(query);
      } catch (error) {
        warnings.push('Autocomplete unavailable: ' + (error instanceof Error ? error.message : String(error)));
      }
    }

    const views: MarketplaceSearchView[] = [];
    for (const sort of sorts) {
      const url = new URL('/ja/search/' + encodeURIComponent(query), BOOTH_BASE_URL);
      url.searchParams.set('sort', sort);
      url.searchParams.set('page', String(page));
      const response = await boothFetch(url);
      const html = await response.text();
      const parsed = parseBoothSearchHtml(html, {
        query,
        sort,
        url: url.toString(),
        maxProducts: input.maxProducts
      });

      const wishlistCounts = await boothWishlistCounts(parsed.products.map(product => product.id));
      const products = parsed.products.map(product => ({
        ...product,
        likes: wishlistCounts.get(product.id) ?? null
      }));
      views.push({
        ...parsed,
        products,
        metrics: metricsForProducts(products)
      });
    }

    return {
      marketplace: 'booth',
      query,
      fetchedAt: new Date().toISOString(),
      capabilities: boothAdapter.capabilities,
      suggestions,
      views,
      comparison: { overlaps: buildOverlap(views) },
      warnings
    };
  }
};

const adapters = new Map<string, MarketplaceAdapter>([
  [boothAdapter.id, boothAdapter]
]);

export function supportedMarketplaceAdapters(): string[] {
  return [...adapters.keys()];
}

export function marketplaceAdapterCapabilities(): Record<string, MarketplaceResearchResult['capabilities']> {
  return Object.fromEntries([...adapters.entries()].map(([id, adapter]) => [id, adapter.capabilities]));
}

export async function marketplaceResearch(input: MarketplaceResearchInput): Promise<MarketplaceResearchResult> {
  const marketplace = (input.marketplace ?? 'booth').trim().toLowerCase();
  const adapter = adapters.get(marketplace);
  if (!adapter) {
    throw new Error(
      'Unsupported marketplace "' + marketplace + '". Supported marketplaces: ' + supportedMarketplaceAdapters().join(', ')
    );
  }
  return adapter.research({ ...input, marketplace });
}
