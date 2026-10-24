/**
 * Daily Search Console sitemap (re)submission for every active registered site
 * that has a Search Console property. See packages/commands/src/site-sitemap-submission.ts
 * for when a sitemap is resubmitted.
 *
 * Env:
 *   SITEMAP_SUBMIT_FORCE=true     resubmit every reachable sitemap regardless of change
 *   SITEMAP_SUBMIT_DRY_RUN=true   decide and report only; no submission, no Firestore write
 *   SITEMAP_SUBMIT_FLOOR_DAYS=7   periodic resubmission floor
 *   SITEMAP_SUBMIT_SITE_IDS=a,b   limit to these site IDs
 */
import { siteRegistryList } from '../packages/commands/src/remote-site-operations.js';
import { DEFAULT_RESUBMIT_FLOOR_DAYS, searchConsolePermissionMap, siteSitemapSubmit } from '../packages/commands/src/site-sitemap-submission.js';
import type { SiteRecord } from '../packages/db/src/site-operations-schema.js';

const force = process.env.SITEMAP_SUBMIT_FORCE === 'true';
const dryRun = process.env.SITEMAP_SUBMIT_DRY_RUN === 'true';
const floorDays = Math.max(1, Math.min(Number(process.env.SITEMAP_SUBMIT_FLOOR_DAYS ?? DEFAULT_RESUBMIT_FLOOR_DAYS) || DEFAULT_RESUBMIT_FLOOR_DAYS, 90));
const onlyIds = new Set((process.env.SITEMAP_SUBMIT_SITE_IDS ?? '').split(',').map(item => item.trim()).filter(Boolean));

async function activeSites() {
  const items: SiteRecord[] = [];
  let pageToken: string | undefined;
  do {
    const result = await siteRegistryList({ status: 'active', limit: 100, ...(pageToken ? { pageToken } : {}) }) as { items: SiteRecord[]; nextPageToken: string | null };
    items.push(...result.items);
    pageToken = result.nextPageToken ?? undefined;
  } while (pageToken);
  return items.filter(site => Boolean(site.searchConsoleProperty) && (!onlyIds.size || onlyIds.has(site.id)));
}

const sites = await activeSites();
const permissions = await searchConsolePermissionMap();
const results = [];
let failures = 0;
for (const site of sites.sort((a, b) => a.id.localeCompare(b.id))) {
  try {
    const result = await siteSitemapSubmit(site, permissions, { force, dryRun, floorDays });
    failures += Number((result as any).failed ?? 0);
    results.push(result);
  } catch (error) {
    failures++;
    results.push({ siteId: site.id, status: 'error', error: error instanceof Error ? error.message.slice(0, 500) : String(error) });
  }
}

const properties = [...new Set(sites.map(site => site.searchConsoleProperty))].map(property => ({ property, permissionLevel: permissions.get(property!) ?? 'not_granted_to_runner' }));
const summary = {
  dryRun, force, floorDays,
  sites: sites.length,
  properties,
  submitted: results.reduce((sum, item: any) => sum + Number(item.submitted ?? 0), 0),
  failed: failures,
  results
};
console.log(JSON.stringify(summary, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  const lines = ['## Sitemap submission', '', `dryRun=${dryRun} force=${force} floorDays=${floorDays}`, '',
    ...properties.map(item => `- property \`${item.property}\`: ${item.permissionLevel}`), '',
    '| site | sitemap | action | reason | urls | lastmod | error |', '|---|---|---|---|---|---|---|',
    ...results.flatMap((item: any) => (item.sitemaps?.length ? item.sitemaps : [{ url: '-', action: item.status, reason: item.reason ?? '', urlCount: '', lastmodCount: '', error: item.error ?? '' }])
      .map((row: any) => `| ${item.siteId} | ${row.url} | ${row.action} | ${row.reason} | ${row.urlCount} | ${row.lastmodCount} | ${String(row.error ?? '').replace(/\|/g, '/').slice(0, 120)} |`))];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}
if (failures > 0) process.exitCode = 1;
