/**
 * Resolve measurement targets from the same Sites Operator registry used by SEO workers.
 * No hard-coded site list. Persist a missing localProjectId once, using a stable
 * name-derived UUID, so the existing GA4/indexation/digest routines can resolve
 * the registered site without changing their storage contract.
 */
import { createHash } from 'node:crypto';
import { siteRegistryList, siteRegistrySave } from '../packages/commands/src/remote-site-operations.js';
import type { SiteRecord } from '../packages/db/src/site-operations-schema.js';

export type MeasurementJob = {
  siteId: string;
  projectId: string;
  name: string;
  domain: string;
  productionUrl: string;
  gscProperty: string;
  sitemapUrl?: string;
  snapshotFile?: string;
};

export type MeasurementDiscovery = {
  jobs: MeasurementJob[];
  skipped: Array<{ siteId: string; reason: string }>;
  errors: Array<{ siteId: string; error: string }>;
  linked: string[];
};

const stableUuid = (siteId: string) => {
  const hex = createHash('sha256').update('keywords-site-measurement:v1:' + siteId).digest('hex').slice(0, 32);
  return [hex.slice(0, 8), hex.slice(8, 12), '5' + hex.slice(13, 16),
    '8' + hex.slice(17, 20), hex.slice(20)].join('-');
};

export function measurementCandidate(site: SiteRecord) {
  if (site.status !== 'active') return { reason: 'not_active' as const };
  if (!site.searchConsoleProperty?.trim()) return { reason: 'gsc_property_not_registered' as const };
  let domain: string, productionUrl: string;
  try {
    const url = new URL(site.productionUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { reason: 'invalid_production_url' as const };
    if (url.username || url.password || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) return { reason: 'invalid_production_url' as const };
    domain = url.hostname;
    productionUrl = url.toString();
  } catch {
    return { reason: 'invalid_production_url' as const };
  }
  const projectId = site.localProjectId ?? stableUuid(site.id);
  return {
    job: {
      siteId: site.id,
      projectId,
      name: site.name,
      domain,
      productionUrl,
      gscProperty: site.searchConsoleProperty.trim()
    } satisfies MeasurementJob,
    needsLink: !site.localProjectId
  };
}

async function registeredSites() {
  const items: SiteRecord[] = [];
  let pageToken: string | undefined;
  const tokens = new Set<string>();
  for (let page = 0; page < 100; page++) {
    const batch = await siteRegistryList({ limit: 100, ...(pageToken ? { pageToken } : {}) });
    items.push(...batch.items);
    if (!batch.nextPageToken) return items;
    if (tokens.has(batch.nextPageToken)) throw new Error('Sites registry returned a repeated pagination token');
    tokens.add(batch.nextPageToken);
    pageToken = batch.nextPageToken;
  }
  throw new Error('Sites registry pagination exceeded 100 pages');
}

export async function discoverMeasurementJobs(): Promise<MeasurementDiscovery> {
  const sites = await registeredSites();
  if (!sites.length) throw new Error('Sites registry returned no sites; refusing empty successful measurement');
  const output: MeasurementDiscovery = { jobs: [], skipped: [], errors: [], linked: [] };
  const projectIds = new Set<string>();
  for (const site of sites) {
    const candidate = measurementCandidate(site);
    if (!candidate.job) {
      output.skipped.push({ siteId: site.id, reason: candidate.reason ?? 'not_eligible' });
      continue;
    }
    const job = candidate.job;
    if (projectIds.has(job.projectId)) {
      output.errors.push({ siteId: site.id, error: 'Duplicate localProjectId in registry' });
      continue;
    }
    projectIds.add(job.projectId);
    if (candidate.needsLink) {
      try {
        await siteRegistrySave({
          id: site.id,
          expectedRevision: site.revision,
          localProjectId: job.projectId
        });
        output.linked.push(site.id);
      } catch (error) {
        output.errors.push({ siteId: site.id, error: `localProjectId link failed: ${error instanceof Error ? error.message : String(error)}` });
        continue;
      }
    }
    output.jobs.push(job);
  }
  if (!output.jobs.length) throw new Error('No eligible measured sites; check registry/GSC settings');
  return output;
}
