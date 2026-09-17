import { projectSiteOperationsMetrics as projectLegacySiteOperationsMetrics } from './site-operations-bridge-legacy.js';
import { completeSiteArticleProjection } from './site-operations-bridge-overflow.js';

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
