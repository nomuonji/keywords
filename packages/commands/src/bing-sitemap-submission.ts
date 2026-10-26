import { z } from 'zod';
import { field, value, firestore, FirestoreError } from '../../db/src/firestore.js';
import type { SiteRecord } from '../../db/src/site-operations-schema.js';
import { DEFAULT_RESUBMIT_FLOOR_DAYS, discoverSitemaps, readSitemapContent } from './site-sitemap-submission.js';

/**
 * Bing Webmaster Tools sitemap submission, run in the same daily lane as the
 * Search Console submission. Bing's anonymous sitemap ping is retired, so this
 * uses the Webmaster API (SubmitFeed / GetFeeds / GetUserSites) with
 * BING_WEBMASTER_API_KEY. The same "only when it tells Bing something new"
 * rule applies: not yet known to Bing, URL set/lastmod changed, or the floor
 * elapsed. A site that is not added/verified in Bing Webmaster is skipped and
 * reported, never auto-added.
 */

const entityId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const BING_API = 'https://ssl.bing.com/webmaster/api.svc/json';
const FETCH_TIMEOUT_MS = 20_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type BingUserSite = { url: string; verified: boolean };
export type BingFeed = { url: string; submitted: string | null; lastCrawled: string | null; status: string | null; urlCount: number | null };

export type BingSubmitReason = 'not_known_to_bing' | 'content_changed' | 'periodic_floor' | 'forced';
export type BingSkipReason = 'unchanged_within_floor' | 'sitemap_unreachable' | 'bing_site_not_registered' | 'bing_site_not_verified' | 'bing_feeds_read_failed';

export type BingStoredEntry = {
  url: string;
  fingerprint: string | null;
  urlCount: number;
  lastSubmittedByOperatorAt: string | null;
  submittedFingerprint: string | null;
  lastAction: 'submitted' | 'skipped' | 'failed';
  reason: string;
  error: string | null;
  bingSubmitted: string | null;
  bingLastCrawled: string | null;
  bingStatus: string | null;
  bingUrlCount: number | null;
};

export type BingSubmissionState = {
  siteId: string;
  bingSiteUrl: string | null;
  verified: boolean | null;
  checkedAt: string;
  floorDays: number;
  sitemaps: BingStoredEntry[];
};

const now = () => new Date().toISOString();
const encodeFields = (data: object) => Object.fromEntries(Object.entries(data).map(([key, item]) => [key, field(item)]));
const decoded = (doc: any) => Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)]));
const statePath = (siteId: string) => `sites/${entityId.parse(siteId)}/sitemapSubmission/bing`;

export async function bingSubmissionStateGet(siteId: string): Promise<BingSubmissionState | null> {
  try {
    const doc = await firestore(`/${statePath(siteId)}`);
    return doc ? decoded(doc) as BingSubmissionState : null;
  } catch (error) {
    if (error instanceof FirestoreError && error.status === 404) return null;
    throw error;
  }
}

async function bingSubmissionStateSave(state: BingSubmissionState) {
  await firestore(`/${statePath(state.siteId)}`, { method: 'PATCH', body: JSON.stringify({ fields: encodeFields(state) }) });
}

/* ---------- pure helpers (covered by scripts/site-sitemap-submission-smoke.ts) ---------- */

/** Bing JSON dates look like "/Date(1698000000000)/" or "/Date(1698000000000-0700)/". */
export function parseBingDate(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const match = /\/Date\((-?\d+)(?:[+-]\d{4})?\)\//.exec(input);
  if (match) {
    const ms = Number(match[1]);
    // Bing uses year 0001 for "never".
    return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
  }
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** Pick the Bing site entry for a production URL: exact host first, then a verified parent domain. */
export function matchBingSite(productionUrl: string, sites: BingUserSite[]): BingUserSite | null {
  let host: string;
  try { host = new URL(productionUrl).hostname.toLowerCase(); } catch { return null; }
  const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase(); } };
  const exact = sites.filter(site => hostOf(site.url) === host);
  if (exact.length) return exact.find(site => site.verified) ?? exact[0];
  const parents = sites.filter(site => site.verified && host.endsWith(`.${hostOf(site.url)}`));
  return parents.sort((a, b) => hostOf(b.url).length - hostOf(a.url).length)[0] ?? null;
}

export function decideBingSubmission(input: {
  content: { ok: boolean; fingerprint: string | null };
  stored: Pick<BingStoredEntry, 'submittedFingerprint' | 'lastSubmittedByOperatorAt'> | null;
  feed: Pick<BingFeed, 'submitted'> | null;
  floorDays: number;
  force?: boolean;
  at?: Date;
}): { submit: true; reason: BingSubmitReason } | { submit: false; reason: BingSkipReason } {
  if (!input.content.ok || !input.content.fingerprint) return { submit: false, reason: 'sitemap_unreachable' };
  if (input.force) return { submit: true, reason: 'forced' };
  if (!input.feed) return { submit: true, reason: 'not_known_to_bing' };
  if (input.stored?.submittedFingerprint && input.stored.submittedFingerprint !== input.content.fingerprint) return { submit: true, reason: 'content_changed' };
  const times = [input.stored?.lastSubmittedByOperatorAt, input.feed.submitted].map(item => (item ? Date.parse(item) : Number.NaN)).filter(Number.isFinite);
  const latest = times.length ? Math.max(...times) : Number.NaN;
  const at = (input.at ?? new Date()).getTime();
  if (!Number.isFinite(latest) || at - latest >= input.floorDays * MS_PER_DAY) return { submit: true, reason: 'periodic_floor' };
  return { submit: false, reason: 'unchanged_within_floor' };
}

/* ---------- Bing Webmaster API ---------- */

export function bingWebmasterApiKey(env: Record<string, string | undefined> = process.env) {
  return env.BING_WEBMASTER_API_KEY?.trim() || null;
}

async function bingCall(method: string, apiKey: string, init: { query?: Record<string, string>; body?: unknown } = {}) {
  const url = new URL(`${BING_API}/${method}`);
  url.searchParams.set('apikey', apiKey);
  for (const [key, item] of Object.entries(init.query ?? {})) url.searchParams.set(key, item);
  const response = await fetch(url, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  const text = await response.text();
  if (!response.ok) {
    // Never echo the request URL: it carries the API key.
    let message = text.slice(0, 300);
    try { const parsed = JSON.parse(text); message = parsed?.Message ?? parsed?.ErrorCode ?? message; } catch { /* keep raw */ }
    throw new Error(`bing_${method}_http_${response.status}: ${String(message).replace(apiKey, '***')}`);
  }
  return text ? JSON.parse(text) : null;
}

export async function bingUserSites(apiKey: string): Promise<BingUserSite[]> {
  const result = await bingCall('GetUserSites', apiKey);
  return (Array.isArray(result?.d) ? result.d : []).map((row: any) => ({ url: String(row?.Url ?? ''), verified: Boolean(row?.IsVerified) })).filter((row: BingUserSite) => row.url);
}

async function bingFeeds(apiKey: string, siteUrl: string): Promise<BingFeed[]> {
  const result = await bingCall('GetFeeds', apiKey, { query: { siteUrl } });
  return (Array.isArray(result?.d) ? result.d : []).map((row: any) => ({
    url: String(row?.Url ?? ''),
    submitted: parseBingDate(row?.Submitted),
    lastCrawled: parseBingDate(row?.LastCrawled),
    status: row?.Status === undefined || row?.Status === null ? null : String(row.Status),
    urlCount: Number.isFinite(Number(row?.UrlCount)) ? Number(row.UrlCount) : null
  }));
}

async function bingSubmitSitemap(apiKey: string, siteUrl: string, feedUrl: string) {
  await bingCall('SubmitFeed', apiKey, { body: { siteUrl, feedUrl } });
}

/* ---------- run ---------- */

export async function siteBingSitemapSubmit(
  site: SiteRecord,
  context: { apiKey: string; userSites: BingUserSite[] },
  options: { force?: boolean; dryRun?: boolean; floorDays?: number } = {}
) {
  const floorDays = options.floorDays ?? DEFAULT_RESUBMIT_FLOOR_DAYS;
  const match = matchBingSite(site.productionUrl, context.userSites);
  const base = { siteId: site.id, engine: 'bing' as const, bingSiteUrl: match?.url ?? null };
  if (!match || !match.verified) {
    const reason: BingSkipReason = match ? 'bing_site_not_verified' : 'bing_site_not_registered';
    if (!options.dryRun) await bingSubmissionStateSave({ siteId: site.id, bingSiteUrl: match?.url ?? null, verified: match ? false : null, checkedAt: now(), floorDays, sitemaps: [] });
    return { ...base, status: 'skipped', reason, submitted: 0, failed: 0, sitemaps: [] };
  }

  const previous = await bingSubmissionStateGet(site.id);
  const storedByUrl = new Map((previous?.sitemaps ?? []).map(entry => [entry.url, entry]));
  const urls = await discoverSitemaps(site);
  let feeds: BingFeed[] = [];
  let feedsError: string | null = null;
  try { feeds = await bingFeeds(context.apiKey, match.url); }
  catch (error) { feedsError = error instanceof Error ? error.message.slice(0, 300) : String(error); }
  const feedByUrl = new Map(feeds.map(feed => [feed.url, feed]));

  const entries: BingStoredEntry[] = [];
  for (const url of urls) {
    const content = await readSitemapContent(url);
    const stored = storedByUrl.get(url) ?? null;
    const feed = feedByUrl.get(url) ?? null;
    // If Bing's feed list could not be read, never treat the sitemap as unknown.
    const decision = feedsError
      ? { submit: false as const, reason: 'bing_feeds_read_failed' as const }
      : decideBingSubmission({ content, stored, feed, floorDays, force: options.force });
    let lastAction: BingStoredEntry['lastAction'] = 'skipped';
    let reason: string = decision.reason;
    let error: string | null = feedsError ?? content.error;
    let lastSubmittedByOperatorAt = stored?.lastSubmittedByOperatorAt ?? null;
    let submittedFingerprint = stored?.submittedFingerprint ?? null;
    if (decision.submit && options.dryRun) {
      reason = `dry_run:${decision.reason}`;
    } else if (decision.submit) {
      try {
        await bingSubmitSitemap(context.apiKey, match.url, url);
        lastAction = 'submitted';
        lastSubmittedByOperatorAt = now();
        submittedFingerprint = content.fingerprint;
        error = null;
      } catch (submitError) {
        lastAction = 'failed';
        error = submitError instanceof Error ? submitError.message.slice(0, 500) : String(submitError);
      }
    } else if (!submittedFingerprint && feed && content.fingerprint) {
      submittedFingerprint = content.fingerprint;
    }
    entries.push({
      url, fingerprint: content.fingerprint, urlCount: content.urlCount,
      lastSubmittedByOperatorAt, submittedFingerprint, lastAction, reason, error,
      bingSubmitted: feed?.submitted ?? null, bingLastCrawled: feed?.lastCrawled ?? null,
      bingStatus: feed?.status ?? null, bingUrlCount: feed?.urlCount ?? null
    });
  }

  if (!options.dryRun) await bingSubmissionStateSave({ siteId: site.id, bingSiteUrl: match.url, verified: true, checkedAt: now(), floorDays, sitemaps: entries });
  return {
    ...base,
    status: urls.length ? 'checked' : 'no_sitemap_found',
    submitted: entries.filter(entry => entry.lastAction === 'submitted').length,
    failed: entries.filter(entry => entry.lastAction === 'failed').length,
    sitemaps: entries.map(entry => ({ url: entry.url, action: entry.lastAction, reason: entry.reason, urlCount: entry.urlCount, lastmodCount: '', error: entry.error }))
  };
}
