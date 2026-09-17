import { createHash } from 'node:crypto';
import { getDatabase } from '@keywords/db';
import { normalizeGa4PropertyId } from '@keywords/research/ga4';
import { hostOf, readPortfolio } from '@keywords/research/portfolio';
import {
  metricSnapshotSave,
  remoteSitesStatus,
  siteArticleGet,
  siteArticleList,
  siteArticleSave,
  siteRegistryResolve
} from './remote-site-operations.js';
import { snapshotSchema } from './blog-contract.js';
import { invalidateSiteOptimizationDueCache } from './site-operations-analysis.js';
import { invalidateSiteQueryFeedbackCache } from './site-query-feedback.js';
import type { SiteArticleRecord, SiteRecord } from '../../db/src/site-operations-schema.js';

const { sqlite } = getDatabase();
const rows = (sql: string, ...args: any[]): any[] => sqlite.prepare(sql).all(...args);

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function canonicalKey(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const path = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '');
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

function landingPageCanonicalKey(productionUrl: string, landingPage: unknown) {
  if (typeof landingPage !== 'string') return null;
  const path = landingPage.trim();
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  try {
    const origin = new URL(productionUrl).origin;
    const resolved = new URL(path, origin);
    if (resolved.origin !== origin) return null;
    return canonicalKey(resolved.toString());
  } catch {
    return null;
  }
}

function aggregateGsc(input: any[]) {
  const valid = input.map(row => ({
    clicks: finite(row.clicks) ?? 0,
    impressions: finite(row.impressions) ?? 0,
    position: finite(row.position)
  }));
  const clicks = valid.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = valid.reduce((sum, row) => sum + row.impressions, 0);
  const positioned = valid.filter(row => row.position !== null && row.impressions > 0);
  const weightedImpressions = positioned.reduce((sum, row) => sum + row.impressions, 0);
  const averagePosition = weightedImpressions > 0
    ? positioned.reduce((sum, row) => sum + Number(row.position) * row.impressions, 0) / weightedImpressions
    : null;
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    averagePosition
  };
}

type ProjectionCounter = { saved: number; reused: number };
async function persist(counter: ProjectionCounter, input: Parameters<typeof metricSnapshotSave>[0]) {
  const result: any = await metricSnapshotSave(input);
  if (result.reused) counter.reused++;
  else counter.saved++;
  return result;
}

function firestoreReady() {
  const status = remoteSitesStatus();
  return status.firestoreConfigured && status.projectConfigured;
}

function articleId(siteId: string, sourceRef: string) {
  return `blog_${createHash('sha256').update(`${siteId}\0${sourceRef}`).digest('hex').slice(0, 32)}`;
}

function articleSlug(url: string) {
  const pathname = new URL(url).pathname.replace(/^\/+|\/+$/g, '');
  return pathname || 'index';
}

export function articleSyncLimit() {
  const configured = Number(process.env.KEYWORDS_CLOUD_ARTICLE_SYNC_LIMIT ?? 500);
  return Number.isFinite(configured) ? Math.max(1, Math.min(Math.floor(configured), 500)) : 500;
}

function parseJson(value: unknown) {
  try { return typeof value === 'string' ? JSON.parse(value) : null; } catch { return null; }
}

function normalizedGa4Metrics(value: any) {
  if (!value || typeof value !== 'object') return null;
  const metrics = {
    sessions: finite(value.sessions),
    activeUsers: finite(value.activeUsers),
    engagement: finite(value.engagement),
    views: finite(value.views)
  };
  return Object.values(metrics).every(item => item === null) ? null : metrics;
}

function normalizedDirectGa4Metrics(payload: any) {
  return normalizedGa4Metrics(payload?.metrics);
}

function completeGa4LandingPages(payload: any) {
  const landingPages = payload?.landingPages;
  if (!landingPages || landingPages.status !== 'complete' || !Array.isArray(landingPages.rows)) return null;
  return landingPages.rows.flatMap((row: any) => {
    const landingPage = typeof row?.landingPage === 'string' ? row.landingPage.trim() : '';
    const metrics = normalizedGa4Metrics(row?.metrics);
    return landingPage && metrics ? [{ landingPage, metrics }] : [];
  });
}

function notFound(error: unknown) {
  return error instanceof Error && /Article not found/i.test(error.message);
}

/**
 * Register exact Blog source mappings in the Sites article registry before
 * projecting page-level metrics. This only uses the already human-confirmed
 * Blog binding and exact local page URLs; it never guesses a repository, site,
 * source path, canonical URL, or publication state.
 *
 * The returned article records are the exact complete set considered during
 * this sync, so downstream metric projection does not re-truncate the registry
 * through the public bounded listing tool.
 */
async function syncBoundBlogArticles(projectId: string, site: SiteRecord) {
  const emptyArticles: SiteArticleRecord[] = [];
  const binding = sqlite.prepare('SELECT * FROM blog_bindings WHERE project_id=?').get(projectId) as any;
  if (!binding) return { status: 'skipped' as const, reason: 'blog_not_bound', considered: 0, created: 0, updated: 0, reused: 0, skipped: 0, warnings: [] as string[], articles: emptyArticles };

  const warnings: string[] = [];
  let snapshot;
  try {
    snapshot = snapshotSchema.parse(JSON.parse(String(binding.snapshot_json)));
  } catch {
    return { status: 'skipped' as const, reason: 'invalid_blog_snapshot', considered: 0, created: 0, updated: 0, reused: 0, skipped: 0, warnings: ['Blog binding snapshot is invalid; article registry sync was skipped.'], articles: emptyArticles };
  }

  let siteOrigin: string | null = null;
  try { siteOrigin = new URL(site.productionUrl).origin; } catch {}
  if (!siteOrigin || siteOrigin !== binding.origin || snapshot.canonical_origin !== binding.origin) {
    return {
      status: 'skipped' as const,
      reason: 'binding_origin_mismatch',
      considered: 0, created: 0, updated: 0, reused: 0, skipped: 0,
      warnings: ['Blog binding origin does not exactly match the registered production site; article identities were not inferred.'],
      articles: emptyArticles
    };
  }

  const limit = articleSyncLimit();
  if (snapshot.sources.length > limit) {
    return {
      status: 'skipped' as const,
      reason: 'article_sync_limit_exceeded',
      considered: 0, created: 0, updated: 0, reused: 0, skipped: 0,
      warnings: [`Blog article registry contains ${snapshot.sources.length} sources, above the safe per-projection limit of ${limit}; partial synchronization was refused.`],
      articles: emptyArticles
    };
  }

  const existing = (await siteArticleList({ siteId: site.id, limit: 100 })).items as SiteArticleRecord[];
  const byPage = new Map(existing.filter(article => article.localPageId).map(article => [String(article.localPageId), article]));
  const byUrl = new Map(existing.flatMap(article => {
    const key = canonicalKey(article.canonicalUrl);
    return key ? [[key, article] as const] : [];
  }));
  const syncedArticles: SiteArticleRecord[] = [];

  let created = 0, updated = 0, reused = 0, skipped = 0;
  for (const source of snapshot.sources) {
    const localPages = rows('SELECT id,url FROM pages WHERE project_id=? AND url=? LIMIT 2', projectId, source.expected_url);
    if (localPages.length !== 1) {
      skipped++;
      warnings.push(`Skipped ${source.source_ref}: expected exactly one local page for ${source.expected_url}.`);
      continue;
    }
    const localPageId = String(localPages[0].id);
    const key = canonicalKey(source.expected_url);
    const pageMatch = byPage.get(localPageId);
    const urlMatch = key ? byUrl.get(key) : undefined;
    if (pageMatch && urlMatch && pageMatch.id !== urlMatch.id) {
      skipped++;
      warnings.push(`Skipped ${source.source_ref}: localPageId and canonicalUrl resolve to different registered articles.`);
      continue;
    }

    const deterministicId = articleId(site.id, source.source_ref);
    let current = pageMatch ?? urlMatch;
    if (!current) {
      try {
        current = await siteArticleGet({ id: deterministicId }) as SiteArticleRecord;
      } catch (error) {
        if (!notFound(error)) throw error;
      }
    }

    const desired = {
      localPageId,
      canonicalUrl: source.expected_url,
      repo: site.repository,
      repoPath: source.source_ref,
      slug: articleSlug(source.expected_url),
      title: source.title || source.source_ref
    };
    if (current) {
      const changed = Object.entries(desired).some(([field, value]) => (current as any)[field] !== value);
      if (!changed) {
        syncedArticles.push(current);
        byPage.set(localPageId, current);
        if (key) byUrl.set(key, current);
        reused++;
        continue;
      }
      const saved = await siteArticleSave({ id: current.id, expectedRevision: current.revision, siteId: site.id, ...desired }) as SiteArticleRecord;
      syncedArticles.push(saved);
      byPage.set(localPageId, saved);
      if (key) byUrl.set(key, saved);
      updated++;
      continue;
    }
    const saved = await siteArticleSave({
      id: deterministicId, expectedRevision: 0, siteId: site.id, ...desired
    }) as SiteArticleRecord;
    syncedArticles.push(saved);
    byPage.set(localPageId, saved);
    if (key) byUrl.set(key, saved);
    created++;
  }

  return { status: 'synced' as const, reason: null, considered: snapshot.sources.length, created, updated, reused, skipped, warnings, articles: syncedArticles };
}

/**
 * Project existing local observations into the Firestore control plane.
 * Acquisition stays in shared commands: GSC in metrics.capture and direct GA4
 * in captureProjectGa4Metrics. The legacy analytics-dashboard file is retained
 * only as a compatibility fallback when no complete direct GA4 import exists.
 */
export async function projectSiteOperationsMetrics(projectId: string) {
  if (!firestoreReady()) return { status: 'skipped' as const, reason: 'firestore_not_configured', projectId };

  const resolved = await siteRegistryResolve({ localProjectId: projectId });
  const site = resolved.site as SiteRecord | null;
  if (!site) return { status: 'skipped' as const, reason: 'site_not_linked', projectId, nextAction: 'Set sites.localProjectId with site_registry_save.' };

  const warnings: string[] = [];
  let syncedArticles: SiteArticleRecord[] = [];
  let articleRegistrySync: Omit<Awaited<ReturnType<typeof syncBoundBlogArticles>>, 'articles'>;
  try {
    const syncResult = await syncBoundBlogArticles(projectId, site);
    syncedArticles = syncResult.articles;
    const { articles: _articles, ...syncSummary } = syncResult;
    articleRegistrySync = syncSummary;
    warnings.push(...articleRegistrySync.warnings);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    articleRegistrySync = { status: 'skipped', reason: 'sync_failed', considered: 0, created: 0, updated: 0, reused: 0, skipped: 0, warnings: [`Blog article registry sync failed: ${message.slice(0, 300)}`] };
    warnings.push(...articleRegistrySync.warnings);
  }

  const articleResponse = syncedArticles.length ? null : await siteArticleList({ siteId: site.id, limit: 100 });
  const articles = syncedArticles.length ? syncedArticles : articleResponse!.items as SiteArticleRecord[];
  const articleByPage = new Map(articles.filter(article => article.localPageId).map(article => [String(article.localPageId), article]));
  const articleByUrl = new Map(articles.flatMap(article => {
    const key = canonicalKey(article.canonicalUrl);
    return key ? [[key, article] as const] : [];
  }));
  const gscSite: ProjectionCounter = { saved: 0, reused: 0 };
  const gscArticle: ProjectionCounter = { saved: 0, reused: 0 };
  const ga4: ProjectionCounter = { saved: 0, reused: 0 };
  const ga4Articles: ProjectionCounter = { saved: 0, reused: 0 };

  const configuredImportLimit = Number(process.env.KEYWORDS_CLOUD_METRIC_IMPORT_LIMIT ?? 4);
  const importLimit = Number.isFinite(configuredImportLimit) ? Math.max(1, Math.min(configuredImportLimit, 20)) : 4;
  const imports = rows(`SELECT * FROM measurement_imports
    WHERE project_id=? AND provider='gsc' AND completeness='complete'
    ORDER BY captured_at DESC LIMIT ?`, projectId, importLimit);

  for (const observation of imports) {
    if (site.searchConsoleProperty && observation.property && site.searchConsoleProperty !== observation.property) {
      warnings.push(`Skipped GSC source ${observation.source_version}: Search Console property does not match the site registry.`);
      continue;
    }
    const queryRows = rows(`SELECT query,clicks,impressions,ctr,position FROM keyword_metric_snapshots
      WHERE project_id=? AND site_url=? AND start_date=? AND end_date=? AND COALESCE(search_type,'web')=? AND observed_at=?
      ORDER BY impressions DESC LIMIT 10000`, projectId, observation.property, observation.start_date, observation.end_date, observation.search_type ?? 'web', observation.captured_at);
    if (!queryRows.length) continue;

    const topQueries = queryRows.slice(0, 200).map(row => ({
      query: String(row.query),
      clicks: finite(row.clicks),
      impressions: finite(row.impressions),
      ctr: finite(row.ctr),
      averagePosition: finite(row.position)
    }));
    await persist(gscSite, {
      siteId: site.id,
      articleId: null,
      provider: 'gsc',
      periodStart: observation.start_date,
      periodEnd: observation.end_date,
      metrics: aggregateGsc(queryRows),
      queries: topQueries,
      completeness: 'complete',
      sourceVersion: `sqlite:gsc:${observation.source_version}`,
      capturedAt: observation.captured_at
    });

    const pageRows = rows(`SELECT page_id,url,clicks,impressions,ctr,position FROM page_metric_snapshots
      WHERE project_id=? AND site_url=? AND start_date=? AND end_date=? AND COALESCE(search_type,'web')=? AND observed_at=?
      ORDER BY impressions DESC LIMIT 10000`, projectId, observation.property, observation.start_date, observation.end_date, observation.search_type ?? 'web', observation.captured_at);
    const seenArticles = new Set<string>();
    for (const row of pageRows) {
      const key = canonicalKey(row.url);
      const article = (row.page_id ? articleByPage.get(String(row.page_id)) : undefined) ?? (key ? articleByUrl.get(key) : undefined);
      if (!article || seenArticles.has(article.id)) continue;
      seenArticles.add(article.id);
      await persist(gscArticle, {
        siteId: site.id,
        articleId: article.id,
        provider: 'gsc',
        periodStart: observation.start_date,
        periodEnd: observation.end_date,
        metrics: {
          clicks: finite(row.clicks), impressions: finite(row.impressions), ctr: finite(row.ctr), averagePosition: finite(row.position)
        },
        queries: [],
        completeness: 'complete',
        sourceVersion: `sqlite:gsc:${observation.source_version}:article:${article.id}`,
        capturedAt: observation.captured_at
      });
    }
  }

  const directGa4Imports = rows(`SELECT * FROM measurement_imports
    WHERE project_id=? AND provider='ga4' AND completeness='complete'
    ORDER BY captured_at DESC LIMIT ?`, projectId, importLimit);
  let directGa4Projected = 0;
  let directGa4ArticleProjected = 0;
  let directGa4UnmappedLandingRows = 0;
  let directGa4AmbiguousArticleRows = 0;
  for (const observation of directGa4Imports) {
    if (!site.ga4PropertyId) {
      warnings.push(`Skipped direct GA4 source ${observation.source_version}: the site registry has no ga4PropertyId.`);
      continue;
    }
    let expectedProperty: string;
    let observedProperty: string;
    try {
      expectedProperty = normalizeGa4PropertyId(site.ga4PropertyId);
      observedProperty = normalizeGa4PropertyId(observation.property);
    } catch {
      warnings.push(`Skipped direct GA4 source ${observation.source_version}: invalid GA4 property identity.`);
      continue;
    }
    if (expectedProperty !== observedProperty) {
      warnings.push(`Skipped direct GA4 source ${observation.source_version}: GA4 property does not match the site registry.`);
      continue;
    }
    const payload = parseJson(observation.payload_json);
    const metrics = normalizedDirectGa4Metrics(payload);
    if (!metrics) {
      warnings.push(`Skipped direct GA4 source ${observation.source_version}: no normalized site metrics were persisted.`);
      continue;
    }
    await persist(ga4, {
      siteId: site.id,
      articleId: null,
      provider: 'ga4',
      periodStart: observation.start_date,
      periodEnd: observation.end_date,
      metrics,
      queries: [],
      completeness: 'complete',
      sourceVersion: `sqlite:ga4:${observation.source_version}`,
      capturedAt: observation.captured_at
    });
    directGa4Projected++;

    const landingPages = completeGa4LandingPages(payload);
    if (!landingPages) {
      if (payload?.landingPages) warnings.push(`Direct GA4 source ${observation.source_version} has no complete landing-page set; site metrics were projected without article GA4.`);
      continue;
    }

    const mappedRows = new Map<string, Array<{ article: SiteArticleRecord; metrics: Record<string, number | null> }>>();
    for (const row of landingPages) {
      const key = landingPageCanonicalKey(site.productionUrl, row.landingPage);
      const article = key ? articleByUrl.get(key) : undefined;
      if (!article) {
        directGa4UnmappedLandingRows++;
        continue;
      }
      const group = mappedRows.get(article.id) ?? [];
      group.push({ article, metrics: row.metrics });
      mappedRows.set(article.id, group);
    }

    for (const group of mappedRows.values()) {
      if (group.length !== 1) {
        directGa4AmbiguousArticleRows += group.length;
        continue;
      }
      const [{ article, metrics: articleMetrics }] = group;
      await persist(ga4Articles, {
        siteId: site.id,
        articleId: article.id,
        provider: 'ga4',
        periodStart: observation.start_date,
        periodEnd: observation.end_date,
        metrics: articleMetrics,
        queries: [],
        completeness: 'complete',
        sourceVersion: `sqlite:ga4:${observation.source_version}:article:${article.id}`,
        capturedAt: observation.captured_at
      });
      directGa4ArticleProjected++;
    }
  }

  let ga4Acquisition: { source: string; importsConsidered: number; projected: number; articleProjected: number; unmappedLandingRows: number; ambiguousArticleRows: number };
  if (directGa4Imports.length) {
    ga4Acquisition = {
      source: 'direct_data_api',
      importsConsidered: directGa4Imports.length,
      projected: directGa4Projected,
      articleProjected: directGa4ArticleProjected,
      unmappedLandingRows: directGa4UnmappedLandingRows,
      ambiguousArticleRows: directGa4AmbiguousArticleRows
    };
    if (directGa4UnmappedLandingRows) warnings.push(`${directGa4UnmappedLandingRows} GA4 landing-page rows did not exactly match a registered article canonical URL.`);
    if (directGa4AmbiguousArticleRows) warnings.push(`${directGa4AmbiguousArticleRows} GA4 landing-page rows collapsed onto ambiguous normalized article identities and were not projected.`);
  } else {
    ga4Acquisition = { source: 'analytics_dashboard_fallback', importsConsidered: 0, projected: 0, articleProjected: 0, unmappedLandingRows: 0, ambiguousArticleRows: 0 };
    const portfolio = await readPortfolio();
    if (portfolio.status === 'available' && portfolio.period && portfolio.generatedAt) {
      const productionHost = hostOf(site.productionUrl);
      const observedSite = productionHost ? portfolio.sites.find(item => item.host === productionHost) : null;
      if (observedSite) {
        const periods = [
          { key: 'current' as const, start: portfolio.period.start, end: portfolio.period.end, metrics: observedSite.ga4.current },
          { key: 'previous' as const, start: portfolio.period.previousStart, end: portfolio.period.previousEnd, metrics: observedSite.ga4.previous }
        ];
        for (const item of periods) {
          if (!item.start || !item.end || !item.metrics) continue;
          await persist(ga4, {
            siteId: site.id,
            articleId: null,
            provider: 'ga4',
            periodStart: item.start,
            periodEnd: item.end,
            metrics: item.metrics,
            queries: [],
            completeness: observedSite.error ? 'partial' : 'complete',
            sourceVersion: `analytics-dashboard:${portfolio.generatedAt}:${productionHost}:${item.key}:${item.start}:${item.end}`,
            capturedAt: portfolio.generatedAt
          });
          ga4Acquisition.projected++;
        }
      } else if (productionHost) {
        warnings.push(`GA4 snapshot has no site entry for ${productionHost}.`);
      }
    } else {
      warnings.push('GA4 portfolio snapshot is unavailable; GSC projection can still succeed.');
    }
  }

  invalidateSiteOptimizationDueCache(projectId);
  invalidateSiteQueryFeedbackCache(projectId);

  return {
    status: 'projected' as const,
    projectId,
    siteId: site.id,
    siteName: site.name,
    articleRegistrySync,
    articleMappings: { registered: articles.length, byLocalPageId: articleByPage.size, byCanonicalUrl: articleByUrl.size },
    gsc: { importsConsidered: imports.length, site: gscSite, articles: gscArticle },
    ga4,
    ga4Articles,
    ga4Acquisition,
    warnings
  };
}