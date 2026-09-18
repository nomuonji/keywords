import { projectSiteOperationsMetrics as projectLegacySiteOperationsMetrics } from './site-operations-bridge-legacy.js';
import { completeSiteArticleProjection } from './site-operations-bridge-overflow.js';
import { refreshSiteDigest } from './remote-site-operations.js';

type Counter = { saved: number; reused: number };

function addCounters(left: Counter, right: Counter): Counter {
  return { saved: left.saved + right.saved, reused: left.reused + right.reused };
}

function count(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function staleScaleWarning(message: string) {
  return message.startsWith('Blog article registry sync is bounded to ')
    || message.startsWith('Blog article registry sync failed:')
    || message.includes('GA4 landing-page rows did not exactly match a registered article canonical URL.')
    || message.includes('GA4 landing-page rows collapsed onto ambiguous normalized article identities');
}

/**
 * Keep the proven site-level projection path intact, then complete article
 * registry/metric projection when a site grows beyond the legacy 100-item
 * in-memory view. The completion pass is bounded to a fully-read 500-article
 * registry and fails closed above that bound.
 */
export async function projectSiteOperationsMetrics(projectId: string) {
  const legacy: any = await projectLegacySiteOperationsMetrics(projectId);
  if (legacy.status !== 'projected') return legacy;
  const completion = await completeSiteArticleProjection(projectId);

  // Refresh the one-document site digest so remote readers get site status in
  // bounded reads. Best effort: local evidence is already persisted above.
  // This runs on both the legacy-only and the completed paths so small sites
  // get a digest too.
  const digestWarnings = [
    ...(legacy.warnings ?? []).filter((message: string) => !staleScaleWarning(message)),
    ...(completion.applied ? [...completion.articleRegistrySync.warnings, ...completion.warnings] : [])
  ];
  try {
    await refreshSiteDigest({
      site: { id: legacy.siteId },
      latestSiteGsc: legacy.latestSiteSnapshots?.gsc,
      latestSiteGa4: legacy.latestSiteSnapshots?.ga4,
      articleCount: completion.applied ? completion.articleMappings.registered : legacy.articleMappings.registered,
      warnings: digestWarnings
    });
  } catch (error) {
    digestWarnings.push(`Site digest refresh failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}; snapshot history remains available through the full scan path.`);
  }

  if (!completion.applied) return legacy;

  const legacySync = legacy.articleRegistrySync ?? {};
  const completedSync = completion.articleRegistrySync;
  const adjustedReused = Math.max(0,
    count(completedSync.reused) - count(legacySync.created) - count(legacySync.updated));

  const articleRegistrySync = {
    status: completedSync.status,
    reason: completedSync.reason,
    considered: completedSync.considered,
    created: count(legacySync.created) + count(completedSync.created),
    updated: count(legacySync.updated) + count(completedSync.updated),
    reused: adjustedReused,
    skipped: completedSync.skipped,
    warnings: completedSync.warnings
  };

  const warnings = [
    ...(legacy.warnings ?? []).filter((message: string) => !staleScaleWarning(message)),
    ...completedSync.warnings,
    ...completion.warnings
  ];

  const ga4Acquisition = legacy.ga4Acquisition?.source === 'direct_data_api'
    ? {
        ...legacy.ga4Acquisition,
        articleProjected: completion.ga4Acquisition.articleProjected,
        unmappedLandingRows: completion.ga4Acquisition.unmappedLandingRows,
        ambiguousArticleRows: completion.ga4Acquisition.ambiguousArticleRows
      }
    : legacy.ga4Acquisition;

  return {
    ...legacy,
    articleRegistrySync,
    articleMappings: completion.articleMappings,
    gsc: {
      ...legacy.gsc,
      articles: addCounters(legacy.gsc.articles, completion.gscArticles)
    },
    ga4Articles: addCounters(legacy.ga4Articles, completion.ga4Articles),
    ga4Acquisition,
    warnings
  };
}
