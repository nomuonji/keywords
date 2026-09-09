import { randomUUID } from 'node:crypto';
import { getDatabase } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { assertOperationAllowed, fingerprint, projectExists } from './guard.js';

const { sqlite } = getDatabase();
const now = () => new Date().toISOString();
const one = (sql: string, ...args: any[]): any => sqlite.prepare(sql).get(...args);
const rows = (sql: string, ...args: any[]): any[] => sqlite.prepare(sql).all(...args);
const run = (sql: string, ...args: any[]) => sqlite.prepare(sql).run(...args);
const parse = <T>(value: string | null | undefined, fallback: T): T => { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };

export interface MeasurementScope {
  provider: string;
  property: string;
  targetOrigin: string | null;
  filters: Array<{ groupType: string; filters: Array<{ dimension: string; operator: string; expression: string }> }>;
  timezone: string;
  searchType: string;
}

function originFromDomain(value: string | null | undefined) {
  if (!value) return null;
  try { return new URL(value.includes('://') ? value : `https://${value}`).origin; } catch { return null; }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveMeasurementScope(input: { projectId: string; property?: string; targetOrigin?: string; searchType?: string; timezone?: string }): MeasurementScope {
  const project = projectExists(input.projectId);
  const property = input.property?.trim() || process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL?.trim();
  if (!property) throw new Error('Search Console property is required');
  const binding = one('SELECT origin FROM blog_bindings WHERE project_id=?', input.projectId);
  const projectOrigin = binding?.origin ?? originFromDomain(project.domain);
  let targetOrigin = input.targetOrigin?.trim() ? new URL(input.targetOrigin).origin : projectOrigin;
  if (property.startsWith('http://') || property.startsWith('https://')) {
    const propertyOrigin = new URL(property).origin;
    targetOrigin ??= propertyOrigin;
    if (targetOrigin !== propertyOrigin && new URL(property).pathname !== '/') throw new Error('URL-prefix Search Console property and target origin are inconsistent');
  }
  if (project.domain && targetOrigin) {
    const projectHost = new URL(project.domain.includes('://') ? project.domain : `https://${project.domain}`).hostname;
    if (new URL(targetOrigin).hostname !== projectHost) throw new Error('Measurement target origin does not match the project domain');
  }
  if (property.startsWith('sc-domain:') && !targetOrigin) throw new Error('Domain Search Console properties require a project or explicit target origin to prevent cross-host mixing');
  const filters = targetOrigin ? [{ groupType: 'and', filters: [{ dimension: 'page', operator: 'includingRegex', expression: `^${escapeRegex(targetOrigin)}(?:/|$)` }] }] : [];
  return { provider: 'gsc', property, targetOrigin: targetOrigin ?? null, filters, timezone: input.timezone ?? 'UTC', searchType: input.searchType ?? 'web' };
}

export const periodDays = (startDate: string, endDate: string) => Math.round((new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / 86_400_000) + 1;

export function measurementScopeKey(input: { scope: MeasurementScope; dimensions: string[]; startDate: string; endDate: string }) {
  return fingerprint({ provider: input.scope.provider, property: input.scope.property, targetOrigin: input.scope.targetOrigin, filters: input.scope.filters, timezone: input.scope.timezone, searchType: input.scope.searchType, dimensions: [...input.dimensions].sort(), days: periodDays(input.startDate, input.endDate) });
}

export function recordMeasurementImport(input: {
  projectId: string;
  provider: string;
  property: string;
  targetOrigin?: string | null;
  filters?: unknown;
  startDate: string;
  endDate: string;
  timezone?: string;
  searchType?: string | null;
  dimensions: string[];
  status: 'succeeded' | 'partial' | 'failed';
  completeness: 'complete' | 'partial' | 'unknown' | 'failed';
  sourceLabel: string;
  sourceVersion: string;
  capturedAt: string;
  payload?: unknown;
}) {
  projectExists(input.projectId);
  const existing = one('SELECT * FROM measurement_imports WHERE project_id=? AND provider=? AND source_version=?', input.projectId, input.provider, input.sourceVersion);
  if (existing) return { id: existing.id, reused: true };
  const id = randomUUID();
  run(`INSERT INTO measurement_imports(id,project_id,provider,property,target_origin,filters_json,start_date,end_date,timezone,search_type,dimensions_json,status,completeness,source_label,source_version,captured_at,payload_json,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, input.projectId, input.provider, input.property, input.targetOrigin ?? null, JSON.stringify(input.filters ?? []), input.startDate, input.endDate, input.timezone ?? 'UTC', input.searchType ?? null, JSON.stringify(input.dimensions), input.status, input.completeness, input.sourceLabel, input.sourceVersion, input.capturedAt, JSON.stringify(input.payload ?? null), now());
  return { id, reused: false };
}

function importView(row: any) {
  return { id: row.id, projectId: row.project_id, provider: row.provider, property: row.property, targetOrigin: row.target_origin, filters: parse(row.filters_json, []), startDate: row.start_date, endDate: row.end_date, timezone: row.timezone, searchType: row.search_type, dimensions: parse(row.dimensions_json, []), status: row.status, completeness: row.completeness, sourceLabel: row.source_label, sourceVersion: row.source_version, capturedAt: row.captured_at, payload: parse(row.payload_json, null), createdAt: row.created_at };
}

function normalizedSnapshot(row: any, kind: 'query' | 'page', importsByCapturedAt: Map<string, any>) {
  const observation = importsByCapturedAt.get(row.observed_at);
  const scope = observation ? `${observation.provider}\u0000${observation.property}\u0000${observation.target_origin ?? ''}\u0000${observation.filters_json}\u0000${observation.timezone}\u0000${observation.search_type ?? 'web'}` : null;
  return {
    id: row.id,
    identity: kind === 'query' ? row.query : row.url,
    query: row.query,
    url: row.url,
    siteUrl: row.site_url,
    startDate: row.start_date,
    endDate: row.end_date,
    searchType: row.search_type ?? 'web',
    clicks: Number(row.clicks), impressions: Number(row.impressions), ctr: Number(row.ctr), position: Number(row.position), observedAt: row.observed_at,
    scopeKey: scope,
    completeness: observation?.completeness ?? 'unknown',
    targetOrigin: observation?.target_origin ?? null,
    sourceVersion: observation?.source_version ?? null
  };
}

export function compatiblePairs<T extends { identity: string; startDate: string; endDate: string; scopeKey: string | null; completeness: string }>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    if (!item.scopeKey || item.completeness !== 'complete') continue;
    const key = `${item.identity}\u0000${item.scopeKey}\u0000${periodDays(item.startDate, item.endDate)}`;
    const group = groups.get(key) ?? [];
    if (!group.some(value => value.startDate === item.startDate && value.endDate === item.endDate)) group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap(group => {
    const sorted = [...group].sort((a, b) => b.endDate.localeCompare(a.endDate));
    if (sorted.length < 2) return [];
    const [latest, previous] = sorted;
    if (new Date(`${latest.startDate}T00:00:00Z`).getTime() <= new Date(`${previous.endDate}T00:00:00Z`).getTime()) return [];
    return [{ latest, previous, periodDays: periodDays(latest.startDate, latest.endDate) }];
  });
}

export function measurementComparisonContext(projectId: string, limit = 25) {
  projectExists(projectId);
  const imports = rows('SELECT * FROM measurement_imports WHERE project_id=? AND provider=? ORDER BY captured_at DESC LIMIT 500', projectId, 'gsc');
  const byCaptured = new Map(imports.map(row => [row.captured_at, row]));
  const queryRows = rows('SELECT * FROM keyword_metric_snapshots WHERE project_id=? ORDER BY end_date DESC,impressions DESC LIMIT 10000', projectId).map(row => normalizedSnapshot(row, 'query', byCaptured));
  const pageRows = rows('SELECT * FROM page_metric_snapshots WHERE project_id=? ORDER BY end_date DESC,impressions DESC LIMIT 10000', projectId).map(row => normalizedSnapshot(row, 'page', byCaptured));
  const queryPairs = compatiblePairs(queryRows); const pagePairs = compatiblePairs(pageRows);
  const positionDrops = queryPairs.filter(({ latest, previous }) => latest.position - previous.position >= 3 && previous.impressions > 0).sort((a, b) => b.previous.impressions - a.previous.impressions).slice(0, limit).map(({ latest, previous, periodDays }) => ({ query: latest.identity, latest, previous, periodDays, positionDelta: latest.position - previous.position, impressionDelta: latest.impressions - previous.impressions }));
  const clickDrops = queryPairs.filter(({ latest, previous }) => previous.clicks >= 5 && latest.clicks <= previous.clicks * 0.7).sort((a, b) => b.previous.clicks - a.previous.clicks).slice(0, limit).map(({ latest, previous, periodDays }) => ({ query: latest.identity, latest, previous, periodDays, clickDelta: latest.clicks - previous.clicks }));
  const pageClickDrops = pagePairs.filter(({ latest, previous }) => previous.clicks >= 5 && latest.clicks <= previous.clicks * 0.7).sort((a, b) => b.previous.clicks - a.previous.clicks).slice(0, limit).map(({ latest, previous, periodDays }) => ({ url: latest.identity, latest, previous, periodDays, clickDelta: latest.clicks - previous.clicks }));
  const totals = {
    queries: Number(one('SELECT COUNT(*) AS n FROM keyword_metric_snapshots WHERE project_id=?', projectId)?.n ?? 0),
    pages: Number(one('SELECT COUNT(*) AS n FROM page_metric_snapshots WHERE project_id=?', projectId)?.n ?? 0)
  };
  return {
    generatedAt: now(),
    definitions: {
      compatible: 'Same provider/property/target origin/filter/timezone/search type, equal period length, non-overlapping periods, and both observations complete.',
      positionDrops: 'Compatible observations only; average position worsened by at least 3.',
      clickDrops: 'Compatible observations only; clicks fell at least 30% from a previous period with at least 5 clicks.',
      pageClickDrops: 'Compatible observations only; page clicks fell at least 30% from a previous period with at least 5 clicks.'
    },
    positionDrops, clickDrops, pageClickDrops, querySnapshots: totals.queries, pageSnapshots: totals.pages,
    loadedForComparison: { queries: queryRows.length, pages: pageRows.length },
    comparisonTruncated: totals.queries > queryRows.length || totals.pages > pageRows.length,
    ignoredUnknownScope: { queries: queryRows.filter(row => !row.scopeKey || row.completeness !== 'complete').length, pages: pageRows.filter(row => !row.scopeKey || row.completeness !== 'complete').length }
  };
}

export const measurementCommands = {
  list: async (_ctx: CommandContext, input: { projectId: string; provider?: string; limit?: number }) => {
    projectExists(input.projectId); const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 50), 200));
    const result = input.provider ? rows('SELECT * FROM measurement_imports WHERE project_id=? AND provider=? ORDER BY captured_at DESC LIMIT ?', input.projectId, input.provider, limit) : rows('SELECT * FROM measurement_imports WHERE project_id=? ORDER BY captured_at DESC LIMIT ?', input.projectId, limit);
    return result.map(importView);
  },
  import: async (ctx: CommandContext, input: { projectId: string; provider: string; property: string; targetOrigin?: string; filters?: unknown; startDate: string; endDate: string; timezone?: string; searchType?: string; dimensions: string[]; status: 'succeeded' | 'partial' | 'failed'; completeness: 'complete' | 'partial' | 'unknown' | 'failed'; sourceLabel: string; sourceVersion: string; capturedAt: string; payload?: unknown }) => {
    assertOperationAllowed(ctx, { projectId: input.projectId, command: 'measurement.import', capability: 'measurement.capture' });
    if (input.targetOrigin) resolveMeasurementScope({ projectId: input.projectId, property: input.property, targetOrigin: input.targetOrigin, searchType: input.searchType, timezone: input.timezone });
    const saved = recordMeasurementImport(input);
    return { ...saved, observation: importView(one('SELECT * FROM measurement_imports WHERE id=?', saved.id)) };
  },
  context: async (_ctx: CommandContext, projectId: string, limit = 25) => measurementComparisonContext(projectId, limit)
};
