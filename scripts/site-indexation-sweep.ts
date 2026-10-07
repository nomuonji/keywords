import { createHash } from 'node:crypto';
import { siteRegistryList } from '../packages/commands/src/remote-site-operations.js';
import { siteIndexationInspect, siteIndexationSnapshotSave } from '../packages/commands/src/site-indexation.js';
import type { SiteRecord } from '../packages/db/src/site-operations-schema.js';

const RUN_INTERVAL_HOURS = 6;
const propertyRunBudget = Math.max(1, Math.min(Number(process.env.SITE_INDEXATION_PROPERTY_RUN_BUDGET ?? 330) || 330, 500));
const siteChunk = Math.max(1, Math.min(Number(process.env.SITE_INDEXATION_SITE_CHUNK ?? 25) || 25, 50));

function stableNumber(value: string) {
  return Number.parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16);
}

function rotate<T>(items: T[], offset: number) {
  if (!items.length) return items;
  const shift = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}

function runSlot(at = new Date()) {
  return Math.floor(at.getTime() / (RUN_INTERVAL_HOURS * 60 * 60 * 1000));
}

function shouldSaveWeeklySnapshot(at = new Date()) {
  return at.getUTCDay() === 0 && at.getUTCHours() === 19;
}

async function activeSites() {
  const items: SiteRecord[] = [];
  let pageToken: string | undefined;
  do {
    const result = await siteRegistryList({ status: 'active', limit: 100, ...(pageToken ? { pageToken } : {}) }) as { items: SiteRecord[]; nextPageToken: string | null };
    items.push(...result.items);
    pageToken = result.nextPageToken ?? undefined;
  } while (pageToken);
  return items.filter(site => Boolean(site.searchConsoleProperty));
}

async function sweepProperty(property: string, sites: SiteRecord[], slot: number) {
  const ordered = rotate([...sites].sort((a, b) => a.id.localeCompare(b.id)), slot + stableNumber(property));
  const active = new Set(ordered.map(site => site.id));
  let remaining = propertyRunBudget;
  let reserved = 0;
  let inspected = 0;
  let failed = 0;
  let skipped = 0;
  let calls = 0;
  const failures: Array<{ siteId: string; error: string }> = [];

  while (remaining > 0 && active.size > 0) {
    let madeProgress = false;
    for (const site of ordered) {
      if (remaining <= 0 || !active.has(site.id)) continue;
      const take = Math.min(siteChunk, remaining);
      try {
        const result = await siteIndexationInspect({ siteId: site.id, limit: take }) as any;
        calls++;
        const thisReserved = Number(result.quota?.reserved ?? 0);
        reserved += thisReserved;
        remaining -= thisReserved;
        inspected += Number(result.inspected ?? 0);
        failed += Number(result.failed ?? 0);
        skipped += Number(result.skipped ?? 0);
        if (thisReserved > 0) madeProgress = true;

        if (result.reason === 'no_due_urls' || Number(result.requested ?? 0) < take || Number(result.failed ?? 0) > 0) {
          active.delete(site.id);
        }
        if (thisReserved < take && Number(result.requested ?? 0) >= take) {
          remaining = 0;
          break;
        }
        if (Number(result.failed ?? 0) > 0) {
          failures.push(...(result.failures ?? []).map((item: any) => ({ siteId: site.id, error: String(item.error ?? 'inspection_failed') })));
        }
      } catch (error) {
        active.delete(site.id);
        failed++;
        failures.push({ siteId: site.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!madeProgress) break;
  }

  return {
    property,
    siteCount: sites.length,
    runBudget: propertyRunBudget,
    chunk: siteChunk,
    calls,
    reserved,
    inspected,
    failed,
    skipped,
    unusedRunBudget: remaining,
    failures: failures.slice(0, 20)
  };
}

async function main() {
  const at = new Date();
  const sites = await activeSites();
  const byProperty = new Map<string, SiteRecord[]>();
  for (const site of sites) {
    const property = site.searchConsoleProperty!;
    const group = byProperty.get(property) ?? [];
    group.push(site);
    byProperty.set(property, group);
  }

  const slot = runSlot(at);
  const properties = [];
  let totalFailures = 0;
  for (const [property, group] of [...byProperty.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const result = await sweepProperty(property, group, slot);
    properties.push(result);
    totalFailures += result.failed;
  }

  const snapshots: Array<{ siteId: string; ok: boolean; error?: string }> = [];
  if (shouldSaveWeeklySnapshot(at) || process.env.SITE_INDEXATION_FORCE_SNAPSHOT === '1') {
    for (const site of sites) {
      try {
        await siteIndexationSnapshotSave({ siteId: site.id });
        snapshots.push({ siteId: site.id, ok: true });
      } catch (error) {
        totalFailures++;
        snapshots.push({ siteId: site.id, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  console.log(JSON.stringify({
    ok: totalFailures === 0,
    generatedAt: at.toISOString(),
    policy: {
      scheduledRunsPerDay: 24 / RUN_INTERVAL_HOURS,
      propertyRunBudget,
      scheduledDailyMaximumPerProperty: propertyRunBudget * (24 / RUN_INTERVAL_HOURS),
      siteChunk,
      apiDailyGuardPerProperty: Number(process.env.SITES_INDEXATION_DAILY_BUDGET ?? 1500),
      officialUrlInspectionQuotaNote: 'Google documents 2,000 QPD and 600 QPM per Search Console site; this scheduler intentionally stays below both.'
    },
    activeSites: sites.length,
    properties,
    weeklySnapshots: snapshots
  }, null, 2));

  if (totalFailures > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
