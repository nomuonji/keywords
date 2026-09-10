import { randomUUID } from 'node:crypto';
import { getDatabase } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { searchConsoleInspect, searchConsoleQuery, searchConsoleSites, type UrlIndexObservation } from '@keywords/research';
import { assertOperationAllowed, reserveOperationBudget, settleOperationBudget } from './guard.js';
import { resolveMeasurementScope } from './measurement.js';
import { propertyContains } from './gsc-property.js';
import { cohortKey, dateOffset, RECOVERY_VERSION, recoveryCohort, recoveryContext, recoveryDate, type RecoverySnapshot } from './recovery-context.js';

const { sqlite } = getDatabase();
const parse = <T>(value: string | null | undefined, fallback: T): T => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
const now = () => new Date().toISOString();


function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/budget|paused|belongs to another|generation|lease/i.test(message)) return 'execution_boundary';
  const http = message.match(/HTTP\s+(\d{3})/);
  if (http) return `http_${http[1]}`;
  if (/credentials|token exchange|OAuth/i.test(message)) return 'authentication_unavailable';
  if (/ENOTFOUND|EAI_AGAIN|private|local|outside/i.test(message)) return 'target_unavailable';
  return 'provider_request_failed';
}

function saveSource(projectId: string, type: string, label: string, url: string, metadata: unknown, runId: string) {
  const id = randomUUID();
  sqlite.prepare('INSERT INTO sources(id,project_id,type,label,url,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(id, projectId, type, label, url, JSON.stringify({ ...metadata as object, collectionRunId: runId }), now());
  return id;
}

export const recoveryCommands = {
  context: async (_ctx: CommandContext, input: { projectId: string }) => recoveryContext(input.projectId),

  capture: async (ctx: CommandContext, input: { projectId: string; siteUrl?: string; endDate?: string }) => {
    const runId = randomUUID(), started = Date.now();
    assertOperationAllowed(ctx, { projectId: input.projectId, command: 'recovery.capture', capability: 'measurement.capture' });
    const binding = sqlite.prepare('SELECT origin FROM blog_bindings WHERE project_id=?').get(input.projectId) as any;
    if (!binding) throw new Error('Connect the Blog site before capturing recovery evidence');
    const targetOrigin = String(binding.origin);
    const endDate = input.endDate ?? recoveryDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Number.isFinite(Date.parse(endDate)) || new Date(endDate).toISOString().slice(0, 10) !== endDate || endDate > recoveryDate()) throw new Error('Recovery end date must be a complete Search Console date (at least three days ago)');
    const startDate = dateOffset(endDate, -20);
    const cohort = recoveryCohort(input.projectId, targetOrigin);
    if (!cohort.length) throw new Error('No same-origin page URLs are available for the fixed recovery sample');
    sqlite.prepare('INSERT INTO runs(id,project_id,work_session_id,actor,actor_id,command,status,input_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(runId, input.projectId, ctx.workSessionId ?? null, ctx.actor, ctx.actorId ?? null, 'recovery.capture', 'running', JSON.stringify({ ...input, endDate }), now());
    let requests = 0;
    const request = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      assertOperationAllowed(ctx, { projectId: input.projectId, command: 'recovery.request', capability: 'measurement.capture' });
      const reservation = reserveOperationBudget(ctx, input.projectId, 'external_request', `recovery:${runId}:${key}`);
      requests++;
      try { const result = await fn(); settleOperationBudget(reservation?.id, 'succeeded'); return result; }
      catch (error) { settleOperationBudget(reservation?.id, 'failed', errorCode(error)); throw error; }
    };
    try {
      let property = input.siteUrl?.trim();
      if (property && !propertyContains(property, targetOrigin)) throw new Error('Search Console property does not cover the bound site');
      const configured = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL?.trim();
      if (!property && configured && propertyContains(configured, targetOrigin)) property = configured;
      if (!property) {
        const cached = sqlite.prepare("SELECT metadata_json FROM sources WHERE project_id=? AND type='gsc_properties' AND created_at>? ORDER BY created_at DESC LIMIT 1")
          .get(input.projectId, new Date(Date.now() - 86400000).toISOString()) as any;
        const properties = cached ? parse<Array<{ siteUrl: string }>>(parse<any>(cached.metadata_json, {}).properties ? JSON.stringify(parse<any>(cached.metadata_json, {}).properties) : null, []) : await request('properties', searchConsoleSites);
        if (!cached) saveSource(input.projectId, 'gsc_properties', 'Accessible Search Console properties', targetOrigin, { properties }, runId);
        property = properties.map(row => row.siteUrl).filter(value => propertyContains(value, targetOrigin))
          .sort((a, b) => Number(b.startsWith('http')) - Number(a.startsWith('http')) || b.length - a.length)[0];
      }
      if (!property) throw new Error('No accessible Search Console property covers the bound site');
      const scope = resolveMeasurementScope({ projectId: input.projectId, property, targetOrigin, timezone: 'America/Los_Angeles', searchType: 'web' });
      const snapshot: RecoverySnapshot = { version: RECOVERY_VERSION, projectId: input.projectId, targetOrigin, property,
        cohort, cohortKey: cohortKey(cohort), startDate, endDate, observedAt: now(), inspections: [], daily: null, errors: [], complete: false };
      for (const url of cohort) {
        // Retry resumes successfully collected URLs for one day, without changing the fixed cohort.
        const cached = sqlite.prepare(`SELECT s.id,s.metadata_json FROM sources s WHERE s.project_id=? AND s.type='gsc_url_inspection'
          AND s.url=? AND s.created_at>? AND json_extract(s.metadata_json,'$.siteUrl')=?
          AND EXISTS (SELECT 1 FROM runs r WHERE r.id=json_extract(s.metadata_json,'$.collectionRunId') AND r.command='recovery.capture')
          ORDER BY s.created_at DESC LIMIT 1`).get(input.projectId, url, new Date(Date.now() - 86400000).toISOString(), property) as any;
        if (cached) { snapshot.inspections.push({ ...parse<UrlIndexObservation>(cached.metadata_json, {} as UrlIndexObservation), sourceId: String(cached.id) }); continue; }
        try {
          const observation = await request(cohortKey([url]), () => searchConsoleInspect({ url, siteUrl: property! }));
          assertOperationAllowed(ctx, { projectId: input.projectId, command: 'recovery.persist', capability: 'measurement.capture' });
          const sourceId = saveSource(input.projectId, 'gsc_url_inspection', `${observation.verdict}: ${url}`, url, observation, runId);
          const page = sqlite.prepare('SELECT id FROM pages WHERE project_id=? AND url=? LIMIT 1').get(input.projectId, url) as any;
          if (page) sqlite.prepare('INSERT OR IGNORE INTO source_links(id,project_id,source_id,target_type,target_id,kind,created_at) VALUES(?,?,?,?,?,?,?)')
            .run(randomUUID(), input.projectId, sourceId, 'page', page.id, 'index_observation', now());
          snapshot.inspections.push({ ...observation, sourceId });
        } catch (error) {
          const code = errorCode(error);
          if (code === 'execution_boundary') throw error;
          snapshot.errors.push({ url, code });
          // Do not spend the rest of a site's API budget on identical auth/quota failures.
          if (['http_401','http_403','http_429','authentication_unavailable'].includes(code)) break;
        }
      }
      if (!snapshot.errors.some(error => ['http_401','http_403','http_429','authentication_unavailable'].includes(error.code))) {
        try {
          const result = await request('daily', () => searchConsoleQuery({ siteUrl: property, startDate, endDate,
            dimensions: ['date'], dimensionFilterGroups: scope.filters, searchType: 'web', dataState: 'final', rowLimit: 100 }));
          if (result.rows.some(row => row.keys.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(row.keys[0]) || row.keys[0] < startDate || row.keys[0] > endDate || !Number.isFinite(row.impressions) || row.impressions < 0 || !Number.isFinite(row.clicks) || row.clicks < 0) || result.rows.length > 21 || new Set(result.rows.map(row => row.keys[0])).size !== result.rows.length) throw new Error('Invalid daily Search Console result');
          snapshot.daily = Array.from({ length: 21 }, (_, index) => {
            const date = dateOffset(startDate, index), row = result.rows.find(item => item.keys[0] === date);
            return { date, impressions: row?.impressions ?? 0, clicks: row?.clicks ?? 0 };
          });
        } catch (error) { const code = errorCode(error); if (code === 'execution_boundary') throw error; snapshot.errors.push({ url: null, code }); }
      }
      snapshot.complete = snapshot.inspections.length === cohort.length && snapshot.daily !== null && snapshot.errors.length === 0;
      assertOperationAllowed(ctx, { projectId: input.projectId, command: 'recovery.persist', capability: 'measurement.capture' });
      snapshot.observedAt = now();
      const sourceId = saveSource(input.projectId, 'seo_recovery_snapshot', `SEO recovery: ${snapshot.inspections.length}/${cohort.length} URLs, ${startDate}–${endDate}`, targetOrigin, snapshot, runId);
      const output = { sourceId, complete: snapshot.complete, inspected: snapshot.inspections.length, sampleSize: cohort.length, requests, errors: snapshot.errors };
      sqlite.prepare("UPDATE runs SET status='succeeded',output_json=?,duration_ms=? WHERE id=?").run(JSON.stringify(output), Date.now() - started, runId);
      return { ...output, recovery: recoveryContext(input.projectId) };
    } catch (error) {
      sqlite.prepare("UPDATE runs SET status='failed',error=?,duration_ms=? WHERE id=?").run(errorCode(error), Date.now() - started, runId);
      throw new Error(`Recovery observation did not complete (${errorCode(error)}). Successful URL observations are retained for retry.`);
    }
  }
};
