import { getDatabase } from '@keywords/db';
import { field, firestore, value } from '../../db/src/firestore.js';
import { dateOffset } from './recovery-context.js';

const { sqlite } = getDatabase();
const rows = (sql: string, ...args: any[]): any[] => sqlite.prepare(sql).all(...args);
const now = () => new Date().toISOString();

type Metric = { clicks: number | null; impressions: number | null; ctr: number | null; averagePosition: number | null };
type Ga4Metric = { organicSessions: number | null; organicActiveUsers: number | null; organicEngagement: number | null; organicViews: number | null };

const finite = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function metric(row: any | undefined): Metric | null {
  if (!row) return null;
  return {
    clicks: finite(row.clicks),
    impressions: finite(row.impressions),
    ctr: finite(row.ctr),
    averagePosition: finite(row.position)
  };
}

function canonical(value: string) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return value;
  }
}

function decode(doc: any) {
  return {
    id: String(doc.name ?? '').split('/').pop(),
    ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)]))
  } as any;
}

const encodeFields = (data: object) =>
  Object.fromEntries(Object.entries(data).map(([key, item]) => [key, field(item)]));

async function siteForProject(projectId: string) {
  const result = await firestore(':runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'sites' }],
        where: { fieldFilter: { field: { fieldPath: 'localProjectId' }, op: 'EQUAL', value: field(projectId) } },
        limit: 2
      }
    })
  });
  const docs = (Array.isArray(result) ? result : []).flatMap((row: any) => row.document ? [decode(row.document)] : []);
  if (docs.length !== 1) throw new Error(`Expected one Sites Operator site for localProjectId=${projectId}; found ${docs.length}`);
  return docs[0];
}

function gscPeriodMap(projectId: string, startDate: string, endDate: string) {
  const data = rows(`SELECT url,clicks,impressions,ctr,position,observed_at FROM page_metric_snapshots
    WHERE project_id=? AND start_date=? AND end_date=?
    ORDER BY observed_at DESC, impressions DESC`, projectId, startDate, endDate);
  const map = new Map<string, any>();
  for (const row of data) {
    const key = canonical(String(row.url));
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

function queryMap(projectId: string, startDate: string, endDate: string) {
  const data = rows(`SELECT url,query,clicks,impressions,ctr,position,observed_at FROM query_page_metric_snapshots
    WHERE project_id=? AND start_date=? AND end_date=?
    ORDER BY observed_at DESC, impressions DESC`, projectId, startDate, endDate);
  const latestSeen = new Map<string, string>();
  const out = new Map<string, any[]>();
  for (const row of data) {
    const url = canonical(String(row.url));
    const observation = String(row.observed_at);
    const seenAt = latestSeen.get(url);
    if (seenAt && seenAt !== observation) continue;
    latestSeen.set(url, observation);
    const list = out.get(url) ?? [];
    if (list.length >= 3) continue;
    list.push({
      query: String(row.query).slice(0, 220),
      clicks: finite(row.clicks),
      impressions: finite(row.impressions),
      ctr: finite(row.ctr),
      averagePosition: finite(row.position)
    });
    out.set(url, list);
  }
  return out;
}

function ga4OrganicLandingMap(projectId: string, startDate: string, endDate: string, productionUrl: string) {
  const row = sqlite.prepare(`SELECT payload_json FROM measurement_imports
    WHERE project_id=? AND provider='ga4' AND start_date=? AND end_date=? AND completeness='complete'
    ORDER BY captured_at DESC LIMIT 1`).get(projectId, startDate, endDate) as any;
  if (!row?.payload_json) return new Map<string, Ga4Metric>();
  let payload: any;
  try { payload = JSON.parse(row.payload_json); } catch { return new Map<string, Ga4Metric>(); }
  if (payload?.organicLandingPages?.status !== 'complete' || !Array.isArray(payload.organicLandingPages.rows)) return new Map<string, Ga4Metric>();
  const origin = new URL(productionUrl).origin;
  const out = new Map<string, Ga4Metric>();
  for (const item of payload.organicLandingPages.rows) {
    const path = String(item?.landingPage ?? '');
    if (!path.startsWith('/') || path.startsWith('//')) continue;
    const url = canonical(new URL(path, origin).toString());
    const m = item?.metrics ?? {};
    out.set(url, {
      organicSessions: finite(m.sessions),
      organicActiveUsers: finite(m.activeUsers),
      organicEngagement: finite(m.engagement),
      organicViews: finite(m.views)
    });
  }
  return out;
}

function measurementStatus(projectId: string, provider: 'gsc' | 'ga4', startDate: string, endDate: string) {
  const row = sqlite.prepare(`SELECT status,completeness,captured_at FROM measurement_imports
    WHERE project_id=? AND provider=? AND start_date=? AND end_date=?
    ORDER BY captured_at DESC LIMIT 1`).get(projectId, provider, startDate, endDate) as any;
  return row ? { status: row.status, completeness: row.completeness, capturedAt: row.captured_at } : null;
}

function selectPlannerPages(input: Array<any>) {
  const exposure = [...input]
    .filter(item => (item.trailing90?.impressions ?? 0) > 0 || (item.current28?.impressions ?? 0) > 0)
    .sort((a, b) => Number(b.trailing90?.impressions ?? b.current28?.impressions ?? 0) - Number(a.trailing90?.impressions ?? a.current28?.impressions ?? 0))
    .slice(0, 35);
  const declines = [...input]
    .filter(item => item.previous28 && item.current28 && Number(item.previous28.impressions ?? 0) > Number(item.current28.impressions ?? 0))
    .sort((a, b) =>
      (Number(b.previous28?.impressions ?? 0) - Number(b.current28?.impressions ?? 0)) -
      (Number(a.previous28?.impressions ?? 0) - Number(a.current28?.impressions ?? 0)))
    .slice(0, 10);
  const unseen = [...input]
    .filter(item => item.notObservedInComplete90dGsc)
    .sort((a, b) => a.url.localeCompare(b.url))
    .slice(0, 15);
  const byUrl = new Map<string, any>();
  for (const item of [...exposure, ...declines, ...unseen]) byUrl.set(item.url, item);
  return [...byUrl.values()].slice(0, 60);
}

export async function refreshSeoPlanningDigest(projectId: string, endDate: string) {
  const site = await siteForProject(projectId);
  const periods = {
    current7: { start: dateOffset(endDate, -6), end: endDate },
    previous7: { start: dateOffset(endDate, -13), end: dateOffset(endDate, -7) },
    current28: { start: dateOffset(endDate, -27), end: endDate },
    previous28: { start: dateOffset(endDate, -55), end: dateOffset(endDate, -28) },
    trailing90: { start: dateOffset(endDate, -89), end: endDate }
  };

  const gsc = Object.fromEntries(Object.entries(periods).map(([key, p]) => [key, gscPeriodMap(projectId, p.start, p.end)])) as Record<string, Map<string, any>>;
  const q28 = queryMap(projectId, periods.current28.start, periods.current28.end);
  const q90 = queryMap(projectId, periods.trailing90.start, periods.trailing90.end);
  const ga7 = ga4OrganicLandingMap(projectId, periods.current7.start, periods.current7.end, site.productionUrl);
  const ga28 = ga4OrganicLandingMap(projectId, periods.current28.start, periods.current28.end, site.productionUrl);
  const ga90 = ga4OrganicLandingMap(projectId, periods.trailing90.start, periods.trailing90.end, site.productionUrl);

  const inventory = rows(`SELECT id,url,title,source,status,last_seen_at FROM pages
    WHERE project_id=? AND url IS NOT NULL AND status NOT IN ('archived','stale')
    ORDER BY url`, projectId);

  const gsc90Status = measurementStatus(projectId, 'gsc', periods.trailing90.start, periods.trailing90.end);
  const complete90 = gsc90Status?.completeness === 'complete';
  const signals = inventory.flatMap(page => {
    const url = canonical(String(page.url));
    if (!/^https?:\/\//i.test(url)) return [];
    return [{
      pageId: String(page.id),
      url,
      title: String(page.title ?? ''),
      source: String(page.source ?? ''),
      current7: metric(gsc.current7.get(url)),
      previous7: metric(gsc.previous7.get(url)),
      current28: metric(gsc.current28.get(url)),
      previous28: metric(gsc.previous28.get(url)),
      trailing90: metric(gsc.trailing90.get(url)),
      organicGa4: {
        current7: ga7.get(url) ?? null,
        current28: ga28.get(url) ?? null,
        trailing90: ga90.get(url) ?? null
      },
      topQueries28: q28.get(url) ?? [],
      topQueries90: q90.get(url) ?? [],
      notObservedInComplete90dGsc: complete90 && !gsc.trailing90.has(url)
    }];
  });

  const digest = {
    siteId: site.id,
    repository: site.repository,
    productionUrl: site.productionUrl,
    generatedAt: now(),
    measurementEnd: endDate,
    inventoryCount: signals.length,
    selectedCount: 0,
    notObservedInComplete90dGscCount: signals.filter(item => item.notObservedInComplete90dGsc).length,
    periods,
    statuses: Object.fromEntries(Object.entries(periods).map(([key, p]) => [key, {
      gsc: measurementStatus(projectId, 'gsc', p.start, p.end),
      ga4: measurementStatus(projectId, 'ga4', p.start, p.end)
    }])),
    pages: selectPlannerPages(signals),
    policy: {
      purpose: 'article_driven_issue_planning',
      plannerMustNotFetchGoogle: true,
      overwriteLatestOnly: true,
      maxPages: 60,
      maxQueriesPerWindowPerPage: 3,
      maxSerializedBytes: 500000,
      absenceIsNotAutomaticDelete: true,
      note: 'Use this digest to choose revise/merge/delete/internal-link/technical/new-article GitHub Issues. Verify repository content and duplicate/open task state before issuing.'
    }
  };
  digest.selectedCount = digest.pages.length;

  // Firestore documents have a hard size ceiling. Keep a conservative JSON
  // byte budget because Firestore's encoded field overhead is larger than
  // JSON itself. Prune lowest-priority tail pages before persistence rather
  // than splitting analytics into more durable records.
  while (Buffer.byteLength(JSON.stringify(digest), 'utf8') > 500_000 && digest.pages.length > 10) {
    digest.pages.pop();
    digest.selectedCount = digest.pages.length;
  }
  const serializedBytes = Buffer.byteLength(JSON.stringify(digest), 'utf8');
  if (serializedBytes > 500_000) throw new Error(`SEO planning digest exceeds storage budget after pruning: ${serializedBytes} bytes`);
  (digest.policy as any).serializedBytes = serializedBytes;

  await firestore(`/seoPlanningDigests/${site.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: encodeFields(digest) })
  });
  return { siteId: site.id, generatedAt: digest.generatedAt, inventoryCount: digest.inventoryCount, selectedCount: digest.selectedCount };
}

