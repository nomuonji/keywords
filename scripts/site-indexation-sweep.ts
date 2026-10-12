import { createHash } from 'node:crypto';
import { siteRegistryList } from '../packages/commands/src/remote-site-operations.js';
import { siteIndexationInspect, siteIndexationSnapshotSave } from '../packages/commands/src/site-indexation.js';
import type { SiteRecord } from '../packages/db/src/site-operations-schema.js';

const RUN_INTERVAL_HOURS = 6;
const globalRunBudget = Math.max(1, Math.min(Number(process.env.SITE_INDEXATION_GLOBAL_RUN_BUDGET ?? 3600) || 3600, 10000));
const propertyRunBudget = Math.max(1, Math.min(Number(process.env.SITE_INDEXATION_PROPERTY_RUN_BUDGET ?? 450) || 450, 1000));
const siteChunk = Math.max(1, Math.min(Number(process.env.SITE_INDEXATION_SITE_CHUNK ?? 50) || 50, 50));

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

function shouldSaveWeeklySnapshot(siteId: string, at = new Date()) {
  // Distribute weekly snapshots across sites and weekdays.
  // Four sweeps per day (UTC 01/07/13/19): save only at 19 UTC on the selected day.
  return at.getUTCDay() === stableNumber(siteId) % 7 && at.getUTCHours() >= 18;
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

async function sweepProperty(property: string, sites: SiteRecord[], slot: number, budget: number) {
  const ordered = rotate([...sites].sort((a, b) => a.id.localeCompare(b.id)), slot + stableNumber(property));
  const active = new Set(ordered.map(site => site.id));
  let remaining = budget;
  let reserved = 0;
  let inspected = 0;
  let failed = 0;
  let skipped = 0;
  let calls = 0;
  let firestoreQuotaExhausted = false;
  const failures: Array<{ siteId: string; error: string }> = [];

  while (remaining > 0 && active.size > 0) {
    let madeProgress = false;
    for (const site of ordered) {
      if (remaining <= 0 || !active.has(site.id)) continue;
      const take = Math.min(siteChunk, remaining);
      try {
        const result = await siteIndexationInspect({ siteId: site.id, limit: take, accelerateUninspected: true }) as any;
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
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ siteId: site.id, error: message });
        // Stop the whole sweep when Firestore is exhausted. Continuing to
        // probe other sites only burns retry attempts and harms SEO operations.
        if (/firestore/i.test(message) && /429|RESOURCE_EXHAUSTED/i.test(message)) {
          firestoreQuotaExhausted = true;
          break;
        }
      }
    }
    if (firestoreQuotaExhausted || !madeProgress) break;
  }

  return {
    property,
    siteCount: sites.length,
    runBudget: budget,
    chunk: siteChunk,
    calls,
    firestoreQuotaExhausted,
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
  let globalRemaining = globalRunBudget;
  let firestoreQuotaExhausted = false;
  // Rotate property priority each run: a global budget must not consistently
  // starve later properties when multiple sites share one Firebase project.
  const orderedProperties = rotate([...byProperty.entries()].sort(([a], [b]) => a.localeCompare(b)), slot);
  for (const [property, group] of orderedProperties) {
    if (globalRemaining <= 0) break;
    const result = await sweepProperty(property, group, slot, Math.min(propertyRunBudget, globalRemaining));
    properties.push(result);
    totalFailures += result.failed;
    globalRemaining -= result.reserved;
    if (result.firestoreQuotaExhausted) {
      firestoreQuotaExhausted = true;
      break;
    }
  }

  const snapshots: Array<{ siteId: string; ok: boolean; error?: string }> = [];
  if (!firestoreQuotaExhausted) {
    for (const site of sites) {
      if (!shouldSaveWeeklySnapshot(site.id, at) && process.env.SITE_INDEXATION_FORCE_SNAPSHOT !== '1') continue;
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
    firestoreQuotaExhausted,
    generatedAt: at.toISOString(),
    policy: {
      scheduledRunsPerDay: 24 / RUN_INTERVAL_HOURS,
      globalRunBudget,
      globalUnusedRunBudget: globalRemaining,
      propertyRunBudget,
      scheduledDailyMaximumAllProperties: globalRunBudget * (24 / RUN_INTERVAL_HOURS),
      scheduledDailyMaximumPerProperty: propertyRunBudget * (24 / RUN_INTERVAL_HOURS),
      siteChunk,
      apiDailyGuardPerProperty: Number(process.env.SITES_INDEXATION_DAILY_BUDGET ?? 1500),
      officialUrlInspectionQuotaNote: 'Google documents 2,000 QPD and 600 QPM per Search Console property (shared across all sites in that property); schedule 1,800 QPD/property and keep 200 for other calls/headroom.'
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
