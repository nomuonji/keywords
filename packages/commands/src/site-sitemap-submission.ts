import { createHash } from 'node:crypto';
import { z } from 'zod';
import { searchConsoleSitemapsList, searchConsoleSitemapSubmit, searchConsoleSites, type SearchConsoleSitemap } from '../../research/src/index.js';
import { field, value, firestore, FirestoreError } from '../../db/src/firestore.js';
import type { SiteRecord } from '../../db/src/site-operations-schema.js';
import { bingSubmissionStateGet } from './bing-sitemap-submission.js';

/**
 * Search Console sitemap submission for registered sites.
 *
 * Resubmitting an unchanged sitemap gives Google no new information, so a
 * sitemap is (re)submitted only when Google has no record of it, when its
 * content (URL set + lastmod values) changed since the last submission, when
 * Google last reported errors, or when the periodic floor has elapsed.
 * Google decides crawling/indexing; a submission is a hint, never a guarantee.
 */

const entityId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const FETCH_TIMEOUT_MS = 20_000;
const MAX_CHILD_SITEMAPS = 50;
const MAX_SITEMAP_BYTES = 10 * 1024 * 1024;
export const DEFAULT_RESUBMIT_FLOOR_DAYS = 7;
const SUBMIT_PERMISSIONS = new Set(['siteOwner', 'siteFullUser']);

export const siteSitemapStatusShape = {
  siteId: entityId.optional()
};

export type SitemapContent = {
  url: string;
  ok: boolean;
  isIndex: boolean;
  urlCount: number;
  lastmodCount: number;
  childCount: number;
  childFailures: number;
  fingerprint: string | null;
  error: string | null;
};

export type SubmitReason = 'not_registered_in_gsc' | 'content_changed' | 'gsc_reported_errors' | 'periodic_floor' | 'forced';
export type SkipReason = 'unchanged_within_floor' | 'sitemap_unreachable' | 'permission_insufficient' | 'gsc_list_failed';

export type StoredSitemapEntry = {
  url: string;
  fingerprint: string | null;
  urlCount: number;
  lastmodCount: number;
  lastSubmittedByOperatorAt: string | null;
  submittedFingerprint: string | null;
  lastAction: 'submitted' | 'skipped' | 'failed';
  reason: string;
  error: string | null;
  gscLastSubmitted: string | null;
  gscLastDownloaded: string | null;
  gscIsPending: boolean | null;
  gscErrors: number | null;
  gscWarnings: number | null;
  gscSubmittedUrls: number | null;
};

export type SitemapSubmissionState = {
  siteId: string;
  property: string;
  permissionLevel: string | null;
  checkedAt: string;
  floorDays: number;
  sitemaps: StoredSitemapEntry[];
};

const now = () => new Date().toISOString();
const encodeFields = (data: object) => Object.fromEntries(Object.entries(data).map(([key, item]) => [key, field(item)]));
const decoded = (doc: any) => Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)]));

async function readPath(path: string) {
  try { return await firestore(`/${path}`); }
  catch (error) { if (error instanceof FirestoreError && error.status === 404) return null; throw error; }
}

function statePath(siteId: string) { return `sites/${entityId.parse(siteId)}/sitemapSubmission/state`; }

export async function sitemapSubmissionStateGet(siteId: string): Promise<SitemapSubmissionState | null> {
  const doc = await readPath(statePath(siteId));
  return doc ? decoded(doc) as SitemapSubmissionState : null;
}

export async function sitemapSubmissionStateSave(state: SitemapSubmissionState) {
  await firestore(`/${statePath(state.siteId)}`, { method: 'PATCH', body: JSON.stringify({ fields: encodeFields(state) }) });
  return state;
}

/* ---------- pure helpers (covered by scripts/site-sitemap-submission-smoke.ts) ---------- */

export function parseRobotsSitemaps(robotsTxt: string): string[] {
  const out: string[] = [];
  for (const line of robotsTxt.split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (match) out.push(match[1]);
  }
  return [...new Set(out)];
}

function decodeXmlEntities(input: string) {
  return input.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
}

/** Extract <loc>/<lastmod> pairs from a urlset or sitemapindex document. */
export function parseSitemapXml(xml: string): { isIndex: boolean; entries: Array<{ loc: string; lastmod: string | null }> } {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const blockTag = isIndex ? 'sitemap' : 'url';
  const entries: Array<{ loc: string; lastmod: string | null }> = [];
  const blockPattern = new RegExp(`<${blockTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${blockTag}>`, 'gi');
  for (const block of xml.matchAll(blockPattern)) {
    const loc = /<loc>([\s\S]*?)<\/loc>/i.exec(block[1]);
    if (!loc) continue;
    const lastmod = /<lastmod>([\s\S]*?)<\/lastmod>/i.exec(block[1]);
    entries.push({ loc: decodeXmlEntities(loc[1]), lastmod: lastmod ? decodeXmlEntities(lastmod[1]) : null });
  }
  return { isIndex, entries };
}

export function sitemapFingerprint(entries: Array<{ loc: string; lastmod: string | null }>) {
  const lines = entries.map(entry => `${entry.loc}\t${entry.lastmod ?? ''}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

function insideSite(site: Pick<SiteRecord, 'productionUrl'>, candidate: string) {
  try {
    const target = new URL(candidate);
    const base = new URL(site.productionUrl);
    return (target.protocol === 'https:' || target.protocol === 'http:') && target.hostname === base.hostname;
  } catch { return false; }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function decideSitemapSubmission(input: {
  content: Pick<SitemapContent, 'ok' | 'fingerprint'>;
  stored: Pick<StoredSitemapEntry, 'submittedFingerprint' | 'lastSubmittedByOperatorAt'> | null;
  gsc: Pick<SearchConsoleSitemap, 'lastSubmitted' | 'errors'> | null;
  canSubmit: boolean;
  floorDays: number;
  force?: boolean;
  at?: Date;
}): { submit: true; reason: SubmitReason } | { submit: false; reason: SkipReason } {
  if (!input.content.ok || !input.content.fingerprint) return { submit: false, reason: 'sitemap_unreachable' };
  if (!input.canSubmit) return { submit: false, reason: 'permission_insufficient' };
  if (input.force) return { submit: true, reason: 'forced' };
  if (!input.gsc) return { submit: true, reason: 'not_registered_in_gsc' };
  if (input.stored?.submittedFingerprint && input.stored.submittedFingerprint !== input.content.fingerprint) return { submit: true, reason: 'content_changed' };
  if (input.gsc.errors > 0) return { submit: true, reason: 'gsc_reported_errors' };
  const lastSubmitted = [input.stored?.lastSubmittedByOperatorAt, input.gsc.lastSubmitted]
    .map(item => (item ? Date.parse(item) : Number.NaN)).filter(Number.isFinite);
  const latest = lastSubmitted.length ? Math.max(...lastSubmitted) : Number.NaN;
  const at = (input.at ?? new Date()).getTime();
  if (!Number.isFinite(latest) || at - latest >= input.floorDays * MS_PER_DAY) return { submit: true, reason: 'periodic_floor' };
  return { submit: false, reason: 'unchanged_within_floor' };
}

/* ---------- network ---------- */

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'SitesOperator-SitemapCheck/1.0' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const text = response.ok ? (await response.text()).slice(0, MAX_SITEMAP_BYTES) : '';
  return { ok: response.ok, status: response.status, text };
}

export async function discoverSitemaps(site: Pick<SiteRecord, 'productionUrl'>): Promise<string[]> {
  const origin = new URL(site.productionUrl).origin;
  try {
    const robots = await fetchText(`${origin}/robots.txt`);
    if (robots.ok) {
      const declared = parseRobotsSitemaps(robots.text).filter(url => insideSite(site, url));
      if (declared.length) return declared;
    }
  } catch { /* fall through to conventional locations */ }
  for (const path of ['/sitemap-index.xml', '/sitemap.xml']) {
    try {
      const probe = await fetchText(`${origin}${path}`);
      if (probe.ok && /<(urlset|sitemapindex)[\s>]/i.test(probe.text)) return [`${origin}${path}`];
    } catch { /* try next */ }
  }
  return [];
}

export async function readSitemapContent(url: string): Promise<SitemapContent> {
  const base: SitemapContent = { url, ok: false, isIndex: false, urlCount: 0, lastmodCount: 0, childCount: 0, childFailures: 0, fingerprint: null, error: null };
  try {
    const root = await fetchText(url);
    if (!root.ok) return { ...base, error: `HTTP ${root.status}` };
    const parsed = parseSitemapXml(root.text);
    if (!parsed.isIndex && !/<urlset[\s>]/i.test(root.text)) return { ...base, error: 'not_a_sitemap_document' };
    if (!parsed.isIndex) {
      return { ...base, ok: true, urlCount: parsed.entries.length, lastmodCount: parsed.entries.filter(entry => entry.lastmod).length, fingerprint: sitemapFingerprint(parsed.entries) };
    }
    const children = parsed.entries.slice(0, MAX_CHILD_SITEMAPS);
    const all: Array<{ loc: string; lastmod: string | null }> = [];
    let childFailures = 0;
    for (const child of children) {
      try {
        const doc = await fetchText(child.loc);
        if (!doc.ok) { childFailures++; continue; }
        all.push(...parseSitemapXml(doc.text).entries);
      } catch { childFailures++; }
    }
    // An incomplete read must not look like a content change.
    if (childFailures > 0) return { ...base, isIndex: true, childCount: children.length, childFailures, error: 'child_sitemap_unreachable' };
    return {
      ...base, ok: true, isIndex: true, childCount: children.length,
      urlCount: all.length, lastmodCount: all.filter(entry => entry.lastmod).length,
      fingerprint: sitemapFingerprint([...parsed.entries.map(entry => ({ loc: `index:${entry.loc}`, lastmod: entry.lastmod })), ...all])
    };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message.slice(0, 300) : String(error) };
  }
}

/* ---------- run ---------- */

export type SitemapRunOptions = { force?: boolean; dryRun?: boolean; floorDays?: number };

export async function searchConsolePermissionMap(): Promise<Map<string, string>> {
  const sites = await searchConsoleSites();
  return new Map(sites.map(row => [row.siteUrl, row.permissionLevel]));
}

export async function siteSitemapSubmit(site: SiteRecord, permissions: Map<string, string>, options: SitemapRunOptions = {}) {
  const property = site.searchConsoleProperty;
  if (!property) return { siteId: site.id, status: 'skipped', reason: 'no_search_console_property' as const };
  const floorDays = options.floorDays ?? DEFAULT_RESUBMIT_FLOOR_DAYS;
  const permissionLevel = permissions.get(property) ?? null;
  const canSubmit = Boolean(permissionLevel && SUBMIT_PERMISSIONS.has(permissionLevel));
  const previous = await sitemapSubmissionStateGet(site.id);
  const storedByUrl = new Map((previous?.sitemaps ?? []).map(entry => [entry.url, entry]));

  const urls = await discoverSitemaps(site);
  let gscRows: SearchConsoleSitemap[] = [];
  let gscReadError: string | null = null;
  try { gscRows = await searchConsoleSitemapsList(property); }
  catch (error) { gscReadError = error instanceof Error ? error.message.slice(0, 300) : String(error); }
  const gscByPath = new Map(gscRows.map(row => [row.path, row]));

  const entries: StoredSitemapEntry[] = [];
  for (const url of urls) {
    const content = await readSitemapContent(url);
    const stored = storedByUrl.get(url) ?? null;
    const gsc = gscByPath.get(url) ?? null;
    // When Google's list could not be read, never treat the sitemap as "not registered".
    const decision = gscReadError
      ? { submit: false as const, reason: 'gsc_list_failed' as const }
      : decideSitemapSubmission({ content, stored, gsc, canSubmit, floorDays, force: options.force });
    let lastAction: StoredSitemapEntry['lastAction'] = 'skipped';
    let reason: string = decision.reason;
    let error: string | null = gscReadError ? `gsc_list_failed: ${gscReadError}` : content.error;
    let lastSubmittedByOperatorAt = stored?.lastSubmittedByOperatorAt ?? null;
    let submittedFingerprint = stored?.submittedFingerprint ?? null;
    if (decision.submit && options.dryRun) {
      reason = `dry_run:${decision.reason}`;
    } else if (decision.submit) {
      try {
        await searchConsoleSitemapSubmit({ siteUrl: property, feedpath: url });
        lastAction = 'submitted';
        lastSubmittedByOperatorAt = now();
        submittedFingerprint = content.fingerprint;
        error = null;
      } catch (submitError) {
        lastAction = 'failed';
        error = submitError instanceof Error ? submitError.message.slice(0, 500) : String(submitError);
      }
    } else if (!submittedFingerprint && gsc && content.fingerprint) {
      // Google already has this sitemap from an earlier manual submission; start change detection from here.
      submittedFingerprint = content.fingerprint;
    }
    entries.push({
      url,
      fingerprint: content.fingerprint,
      urlCount: content.urlCount,
      lastmodCount: content.lastmodCount,
      lastSubmittedByOperatorAt,
      submittedFingerprint,
      lastAction,
      reason,
      error,
      gscLastSubmitted: gsc?.lastSubmitted ?? null,
      gscLastDownloaded: gsc?.lastDownloaded ?? null,
      gscIsPending: gsc ? gsc.isPending : null,
      gscErrors: gsc ? gsc.errors : null,
      gscWarnings: gsc ? gsc.warnings : null,
      gscSubmittedUrls: gsc?.submittedUrls ?? null
    });
  }

  const state: SitemapSubmissionState = { siteId: site.id, property, permissionLevel, checkedAt: now(), floorDays, sitemaps: entries };
  if (!options.dryRun) await sitemapSubmissionStateSave(state);
  return {
    siteId: site.id,
    status: urls.length ? 'checked' : 'no_sitemap_found',
    property,
    permissionLevel,
    submitted: entries.filter(entry => entry.lastAction === 'submitted').length,
    failed: entries.filter(entry => entry.lastAction === 'failed').length,
    sitemaps: entries.map(entry => ({ url: entry.url, action: entry.lastAction, reason: entry.reason, urlCount: entry.urlCount, lastmodCount: entry.lastmodCount, error: entry.error }))
  };
}

/* ---------- MCP read (never calls Google) ---------- */

export async function siteSitemapStatus(input: unknown, listSites: () => Promise<SiteRecord[]>) {
  const args = z.object(siteSitemapStatusShape).strict().parse(input ?? {});
  const sites = args.siteId ? [{ id: args.siteId } as SiteRecord] : await listSites();
  const items = [];
  for (const site of sites) {
    const [state, bing] = await Promise.all([sitemapSubmissionStateGet(site.id), bingSubmissionStateGet(site.id)]);
    items.push({ ...(state ?? { siteId: site.id, checkedAt: null, sitemaps: [], note: 'not_checked_yet' }), bing: bing ?? { checkedAt: null, note: 'not_checked_yet' } });
  }
  return {
    policy: {
      schedule: 'GitHub Actions site-sitemap-submission, daily (Search Console, and Bing Webmaster when BING_WEBMASTER_API_KEY is set)',
      resubmitWhen: ['not registered in Search Console', 'sitemap URL set or lastmod changed', 'Search Console reported errors', `no submission for ${DEFAULT_RESUBMIT_FLOOR_DAYS} days`],
      bing: 'Same rule via Bing Webmaster SubmitFeed: not yet in GetFeeds, content changed, or floor elapsed. Sites not added/verified in Bing Webmaster are reported as bing_site_not_registered / bing_site_not_verified.',
      note: 'Submission is a crawl hint. Google decides whether and when pages are indexed. Sitemaps without <lastmod> give Google little signal about changed pages.'
    },
    items
  };
}
