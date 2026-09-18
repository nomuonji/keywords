import { createHash } from 'node:crypto';
import { getDatabase } from '@keywords/db';
import { field, firestore, value } from '@keywords/db/firestore';
import { normalizeGa4PropertyId } from '@keywords/research/ga4';
import { metricSnapshotSave, paceCloudWrite, siteArticleSave, siteRegistryResolve } from './remote-site-operations.js';
import { snapshotSchema } from './blog-contract.js';
import type { SiteArticleRecord, SiteRecord } from '../../db/src/site-operations-schema.js';

const { sqlite } = getDatabase();
const rows = (sql: string, ...args: any[]): any[] => sqlite.prepare(sql).all(...args);

type Counter = { saved: number; reused: number };
const zeroCounter = (): Counter => ({ saved: 0, reused: 0 });

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

function completeGa4LandingPages(payload: any) {
  const landingPages = payload?.landingPages;
  if (!landingPages || landingPages.status !== 'complete' || !Array.isArray(landingPages.rows)) return null;
  return landingPages.rows.flatMap((row: any) => {
    const landingPage = typeof row?.landingPage === 'string' ? row.landingPage.trim() : '';
    const metrics = normalizedGa4Metrics(row?.metrics);
    return landingPage && metrics ? [{ landingPage, metrics }] : [];
  });
}

function articleId(siteId: string, sourceRef: string) {
  return `blog_${createHash('sha256').update(`${siteId}\0${sourceRef}`).digest('hex').slice(0, 32)}`;
}

function articleSlug(url: string) {
  const pathname = new URL(url).pathname.replace(/^\/+|\/+$/g, '');
  return pathname || 'index';
}

function legacySyncLimit() {
  const configured = Number(process.env.KEYWORDS_CLOUD_ARTICLE_SYNC_LIMIT ?? 100);
  return Number.isFinite(configured) ? Math.max(1, Math.min(Math.floor(configured), 100)) : 100;
}

function importLimit() {
  const configured = Number(process.env.KEYWORDS_CLOUD_METRIC_IMPORT_LIMIT ?? 4);
  return Number.isFinite(configured) ? Math.max(1, Math.min(configured, 20)) : 4;
}

function decoded(doc: any) {
  return {
    id: String(doc.name ?? '').split('/').pop(),
    ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)]))
  };
}

function articleRecord(doc: any): SiteArticleRecord {
  return { localPageId: null, canonicalUrl: null, ...decoded(doc) } as SiteArticleRecord;
}

async function allSiteArticles(siteId: string) {
  const result = await firestore(':runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'articles' }],
        where: { fieldFilter: { field: { fieldPath: 'siteId' }, op: 'EQUAL', value: field(siteId) } },
        limit: 501
      }
    })
  });
  const items = (Array.isArray(result) ? result : [])
    .flatMap((row: any) => row.document ? [articleRecord(row.document)] : [])
    .sort((a: SiteArticleRecord, b: SiteArticleRecord) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (items.length > 500) {
    throw new Error('Sites article registry exceeds the 500-article complete-read safety bound; add indexed pagination before continuing automatic article projection');
  }
  return items;
}

async function persist(counter: Counter, input: Parameters<typeof metricSnapshotSave>[0]) {
  const saved: any = await metricSnapshotSave(input);
  if (saved.reused) counter.reused++;
  else {
    counter.saved++;
    await paceCloudWrite();
  }
}

async function syncCompleteBoundBlogArticles(projectId: string, site: SiteRecord, existing: SiteArticleRecord[]) {
  const binding = sqlite.prepare('SELECT * FROM blog_bindings WHERE project_id=?').get(projectId) as any;
  if (!binding) return {
    status: 'skipped' as const, reason: 'blog_not_bound', sourceCount: 0, considered: 0,
    created: 0, updated: 0, reused: 0, skipped: 0, warnings: [] as string[]
  };

  let snapshot;
  try {
    snapshot = snapshotSchema.parse(JSON.parse(String(binding.snapshot_json)));
  } catch {
    return {
      status: 'skipped' as const, reason: 'invalid_blog_snapshot', sourceCount: 0, considered: 0,
      created: 0, updated: 0, reused: 0, skipped: 0,
      warnings: ['Blog binding snapshot is invalid; article registry completion was skipped.']
    };
  }

  let siteOrigin: string | null = null;
  try { siteOrigin = new URL(site.productionUrl).origin; } catch {}
  if (!siteOrigin || siteOrigin !== binding.origin || snapshot.canonical_origin !== binding.origin) {
    return {
      status: 'skipped' as const, reason: 'binding_origin_mismatch', sourceCount: snapshot.sources.length, considered: 0,
      created: 0, updated: 0, reused: 0, skipped: 0,
      warnings: ['Blog binding origin does not exactly match the registered production site; article identities were not inferred.']
    };
  }
  if (snapshot.sources.length > 500) {
    throw new Error(`Blog snapshot has ${snapshot.sources.length} sources; automatic Sites registry completion is bounded to 500 until indexed pagination is implemented`);
  }

  const byPage = new Map(existing.filter(article => article.localPageId).map(article => [String(article.localPageId), article]));
  const byUrl = new Map(existing.flatMap(article => {
    const key = canonicalKey(article.canonicalUrl);
    return key ? [[key, article] as const] : [];
  }));
  const warnings: string[] = [];
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
    const current = pageMatch ?? urlMatch;
    const desired = {
      localPageId,
      canonicalUrl: source.expected_url,
      repo: site.repository,
      repoPath: source.source_ref,
      slug: articleSlug(source.expected_url),
      title: source.title || source.source_ref
    };
    if (current && !Object.entries(desired).some(([fieldName, expected]) => (current as any)[fieldName] !== expected)) {
      reused++;
      continue;
    }
    if (!current && existing.length + created >= 500) {
      throw new Error('Creating another article would exceed the 500-article complete-read safety bound; add indexed pagination before continuing automatic article sync');
    }
    const saved = await siteArticleSave(current
      ? { id: current.id, expectedRevision: current.revision, siteId: site.id, ...desired }
      : { id: articleId(site.id, source.source_ref), expectedRevision: 0, siteId: site.id, ...desired }) as SiteArticleRecord;
    byPage.set(localPageId, saved);
    if (key) byUrl.set(key, saved);
    if (current) updated++;
    else created++;
    await paceCloudWrite();
  }

  return {
    status: 'synced' as const, reason: null, sourceCount: snapshot.sources.length, considered: snapshot.sources.length,
    created, updated, reused, skipped, warnings
  };
}

export async function completeSiteArticleProjection(projectId: string) {
  const resolved = await siteRegistryResolve({ localProjectId: projectId });
  const site = resolved.site as SiteRecord | null;
  if (!site) throw new Error('No Sites Operator site is linked to this local project');

  const beforeSync = await allSiteArticles(site.id);
  const legacyProjectedIds = new Set(beforeSync.slice(0, 100).map(article => article.id));
  const sync = await syncCompleteBoundBlogArticles(projectId, site, beforeSync);
  const articles = await allSiteArticles(site.id);
  const scaleRelevant = beforeSync.length > 100 || articles.length > 100 || sync.sourceCount > legacySyncLimit();

  if (!scaleRelevant) {
    return {
      applied: false as const,
      articleRegistrySync: sync,
      articleMappings: {
        registered: articles.length,
        byLocalPageId: articles.filter(article => article.localPageId).length,
        byCanonicalUrl: articles.filter(article => canonicalKey(article.canonicalUrl)).length
      },
      gscArticles: zeroCounter(),
      ga4Articles: zeroCounter(),
      ga4Acquisition: { directImports: 0, articleProjected: 0, unmappedLandingRows: 0, ambiguousArticleRows: 0 },
      warnings: [] as string[]
    };
  }

  const articleByPage = new Map(articles.filter(article => article.localPageId).map(article => [String(article.localPageId), article]));
  const articleByUrl = new Map(articles.flatMap(article => {
    const key = canonicalKey(article.canonicalUrl);
    return key ? [[key, article] as const] : [];
  }));
  const gscArticles = zeroCounter();
  const ga4Articles = zeroCounter();
  const warnings: string[] = [];

  const gscImports = rows(`SELECT * FROM measurement_imports
    WHERE project_id=? AND provider='gsc' AND completeness='complete'
    ORDER BY captured_at DESC LIMIT ?`, projectId, importLimit());
  for (const observation of gscImports) {
    if (site.searchConsoleProperty && observation.property && site.searchConsoleProperty !== observation.property) continue;
    const queryEvidence = rows(`SELECT id FROM keyword_metric_snapshots
      WHERE project_id=? AND site_url=? AND start_date=? AND end_date=? AND COALESCE(search_type,'web')=? AND observed_at=? LIMIT 1`,
      projectId, observation.property, observation.start_date, observation.end_date, observation.search_type ?? 'web', observation.captured_at);
    if (!queryEvidence.length) continue;
    const pageRows = rows(`SELECT page_id,url,clicks,impressions,ctr,position FROM page_metric_snapshots
      WHERE project_id=? AND site_url=? AND start_date=? AND end_date=? AND COALESCE(search_type,'web')=? AND observed_at=?
      ORDER BY impressions DESC LIMIT 10000`, projectId, observation.property, observation.start_date, observation.end_date, observation.search_type ?? 'web', observation.captured_at);
    const seen = new Set<string>();
    for (const row of pageRows) {
      const key = canonicalKey(row.url);
      const article = (row.page_id ? articleByPage.get(String(row.page_id)) : undefined) ?? (key ? articleByUrl.get(key) : undefined);
      if (!article || legacyProjectedIds.has(article.id) || seen.has(article.id)) continue;
      seen.add(article.id);
      await persist(gscArticles, {
        siteId: site.id,
        articleId: article.id,
        provider: 'gsc',
        periodStart: observation.start_date,
        periodEnd: observation.end_date,
        metrics: { clicks: finite(row.clicks), impressions: finite(row.impressions), ctr: finite(row.ctr), averagePosition: finite(row.position) },
        queries: [],
        completeness: 'complete',
        sourceVersion: `sqlite:gsc:${observation.source_version}:article:${article.id}`,
        capturedAt: observation.captured_at
      });
    }
  }

  const directGa4Imports = rows(`SELECT * FROM measurement_imports
    WHERE project_id=? AND provider='ga4' AND completeness='complete'
    ORDER BY captured_at DESC LIMIT ?`, projectId, importLimit());
  let fullArticleProjected = 0;
  let fullUnmappedLandingRows = 0;
  let fullAmbiguousArticleRows = 0;
  for (const observation of directGa4Imports) {
    if (!site.ga4PropertyId) continue;
    try {
      if (normalizeGa4PropertyId(site.ga4PropertyId) !== normalizeGa4PropertyId(observation.property)) continue;
    } catch {
      continue;
    }
    const payload = parseJson(observation.payload_json);
    const landingPages = completeGa4LandingPages(payload);
    if (!landingPages) continue;
    const mapped = new Map<string, Array<{ article: SiteArticleRecord; metrics: Record<string, number | null> }>>();
    for (const row of landingPages) {
      const key = landingPageCanonicalKey(site.productionUrl, row.landingPage);
      const article = key ? articleByUrl.get(key) : undefined;
      if (!article) {
        fullUnmappedLandingRows++;
        continue;
      }
      const group = mapped.get(article.id) ?? [];
      group.push({ article, metrics: row.metrics });
      mapped.set(article.id, group);
    }
    for (const group of mapped.values()) {
      if (group.length !== 1) {
        fullAmbiguousArticleRows += group.length;
        continue;
      }
      const [{ article, metrics }] = group;
      fullArticleProjected++;
      if (legacyProjectedIds.has(article.id)) continue;
      await persist(ga4Articles, {
        siteId: site.id,
        articleId: article.id,
        provider: 'ga4',
        periodStart: observation.start_date,
        periodEnd: observation.end_date,
        metrics,
        queries: [],
        completeness: 'complete',
        sourceVersion: `sqlite:ga4:${observation.source_version}:article:${article.id}`,
        capturedAt: observation.captured_at
      });
    }
  }
  if (fullUnmappedLandingRows) warnings.push(`${fullUnmappedLandingRows} GA4 landing-page rows did not exactly match a registered article canonical URL.`);
  if (fullAmbiguousArticleRows) warnings.push(`${fullAmbiguousArticleRows} GA4 landing-page rows collapsed onto ambiguous normalized article identities and were not projected.`);

  return {
    applied: true as const,
    articleRegistrySync: sync,
    articleMappings: {
      registered: articles.length,
      byLocalPageId: articleByPage.size,
      byCanonicalUrl: articleByUrl.size
    },
    gscArticles,
    ga4Articles,
    ga4Acquisition: {
      directImports: directGa4Imports.length,
      articleProjected: fullArticleProjected,
      unmappedLandingRows: fullUnmappedLandingRows,
      ambiguousArticleRows: fullAmbiguousArticleRows
    },
    warnings
  };
}
