import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_SITEMAPS = 25;
const MAX_URLS = 10_000;
const MAX_BYTES = 5_000_000;

function isPrivateIp(address: string) {
  const value = address.toLowerCase();
  if (value === '::1' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value)) return true;
  if (isIP(value) !== 4) return false;
  const [a, b] = value.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function assertPublicUrl(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http/https sitemap URLs are allowed');
  if (process.env.KEYWORDS_ALLOW_PRIVATE_FETCH === '1') return;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Private/local hosts are not allowed');
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Private/local IP addresses are not allowed');
    return;
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateIp(item.address))) throw new Error('Sitemap resolves to a private/local address');
}

async function fetchXml(input: string, redirects = 0, onRequest?: (url: string) => Promise<void>): Promise<{ xml: string; finalUrl: string }> {
  if (redirects > 5) throw new Error('Too many sitemap redirects');
  const url = new URL(input);
  if (url.username || url.password) throw new Error('Sitemap URLs cannot contain credentials');
  await assertPublicUrl(url);
  await onRequest?.(url.toString());
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'keywords-research/0.1' } });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw new Error(`Redirect without location from ${url}`);
    const next = new URL(location, url);
    if (next.origin !== url.origin) throw new Error('Cross-origin sitemap redirect rejected');
    return fetchXml(next.toString(), redirects + 1, onRequest);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} from sitemap ${url}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new Error('Sitemap is too large');
  const xml = await response.text();
  if (Buffer.byteLength(xml) > MAX_BYTES) throw new Error('Sitemap is too large');
  return { xml, finalUrl: url.toString() };
}

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
const locations = (xml: string) => [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)].map(match => decode(match[1].trim())).filter(Boolean);

export interface SitemapDiscovery {
  sitemapUrl: string;
  sitemaps: string[];
  urls: string[];
  fetchedAt: string;
  complete: boolean;
  rejectedUrls: number;
}

export async function fetchSitemapUrls(input: { sitemapUrl: string; targetOrigin?: string; discover?: boolean; onRequest?: (url: string) => Promise<void> }): Promise<SitemapDiscovery> {
  const origin = input.targetOrigin ?? new URL(input.sitemapUrl).origin;
  if (new URL(input.sitemapUrl).origin !== origin) throw new Error('Sitemap must belong to the target origin');
  const queue = [input.sitemapUrl];
  const seen = new Set<string>();
  const urls = new Set<string>();
  const sitemaps: string[] = [];
  let complete = true, rejectedUrls = 0, triedDiscovery = false;
  while (queue.length && seen.size < MAX_SITEMAPS && urls.size < MAX_URLS) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    let fetched: { xml: string; finalUrl: string };
    try { fetched = await fetchXml(next, 0, input.onRequest); }
    catch (error) {
      if (!input.discover || triedDiscovery || sitemaps.length || !/HTTP (404|410)/.test(String(error))) throw error;
      triedDiscovery = true;
      try {
        const robots = await fetchXml(new URL('/robots.txt', origin).toString(), 0, input.onRequest);
        const declared = [...robots.xml.matchAll(/^\s*Sitemap:\s*(\S+)/gim)].map(match => match[1]).filter(value => { try { return new URL(value).origin === origin; } catch { return false; } });
        for (const value of declared) if (!seen.has(value) && !queue.includes(value)) queue.push(value);
      } catch (robotsError) { if (!/HTTP (404|410)/.test(String(robotsError))) throw robotsError; }
      if (!queue.length) queue.push(new URL('/sitemap-index.xml', origin).toString());
      continue;
    }
    const { xml, finalUrl } = fetched;
    if (!/<(?:urlset|sitemapindex)\b/i.test(xml)) throw new Error('Response is not a sitemap XML document');
    sitemaps.push(finalUrl);
    const locs = locations(xml);
    const isIndex = /<sitemapindex\b/i.test(xml);
    if (isIndex) {
      for (const loc of locs) {
        let url: URL;
        try { url = new URL(loc, finalUrl); } catch { rejectedUrls++; complete = false; continue; }
        if (url.origin !== origin || url.username || url.password) { rejectedUrls++; complete = false; continue; }
        if (!seen.has(url.toString()) && !queue.includes(url.toString())) {
          if (queue.length + seen.size < MAX_SITEMAPS) queue.push(url.toString()); else complete = false;
        }
      }
    } else {
      for (const loc of locs) {
        if (urls.size >= MAX_URLS) { complete = false; break; }
        try {
          const url = new URL(loc, finalUrl);
          if (url.origin !== origin || url.username || url.password || url.hash) { rejectedUrls++; complete = false; continue; }
          urls.add(url.toString());
        } catch { rejectedUrls++; complete = false; }
      }
    }
  }
  if (queue.length) complete = false;
  return { sitemapUrl: sitemaps[0] ?? input.sitemapUrl, sitemaps, urls: [...urls], fetchedAt: new Date().toISOString(), complete, rejectedUrls };
}
