import { count } from 'drizzle-orm';
import { backupDatabase, databaseDiagnostics, getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const { db, sqlite, path: databasePath } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const googleAdsConfigured = () => Boolean(
  (process.env.GOOGLE_ADS_KEYWORD_VOLUME_API_URL ?? process.env.KEYWORD_VOLUME_API_URL)
  || ((process.env.GOOGLE_ADS_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN || (process.env.GOOGLE_ADS_REFRESH_TOKEN || process.env.ADS_REFRESH_TOKEN) && (process.env.GOOGLE_ADS_CLIENT_ID || process.env.ADS_CLIENT_ID) && (process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.ADS_CLIENT_SECRET))
    && (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || process.env.ADS_DEVELOPER_TOKEN)
    && (process.env.GOOGLE_ADS_CUSTOMER_ID || process.env.ADS_CUSTOMER_ID))
);

async function withRun<T>(ctx: CommandContext, command: string, input: unknown, fn: () => Promise<T>): Promise<T> {
  const runId = id(); const started = Date.now(); const createdAt = now();
  try {
    const output = await fn();
    await db.insert(schema.runs).values({ id: runId, projectId: ctx.projectId ?? null, workSessionId: ctx.workSessionId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null, command, status: 'succeeded', inputJson: JSON.stringify(input ?? null), outputJson: JSON.stringify(output ?? null), durationMs: Date.now() - started, createdAt });
    return output;
  } catch (error) {
    await db.insert(schema.runs).values({ id: runId, projectId: ctx.projectId ?? null, workSessionId: ctx.workSessionId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null, command, status: 'failed', inputJson: JSON.stringify(input ?? null), error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started, createdAt });
    throw error;
  }
}

function backupStatus() {
  const configured = process.env.KEYWORDS_BACKUP_DIR?.trim();
  const directory = configured ? resolve(configured) : join(dirname(databasePath), 'backups');
  if (!existsSync(directory)) return { directory, exists: false, latest: null, ageHours: null, stale: true };
  const files = readdirSync(directory).filter(name => name.endsWith('.sqlite')).map(name => {
    const path = join(directory, name); const stat = statSync(path); return { path, mtimeMs: stat.mtimeMs, size: stat.size };
  }).sort((a,b)=>b.mtimeMs-a.mtimeMs);
  const latest = files[0] ?? null; const ageHours = latest ? (Date.now() - latest.mtimeMs) / 3_600_000 : null;
  return { directory, exists: true, latest, ageHours, stale: ageHours === null || ageHours > Number(process.env.KEYWORDS_BACKUP_MAX_AGE_HOURS ?? 24) };
}

function schemaStatus() {
  const required = ['projects','runs','work_sessions','review_requests','discovery_jobs','operation_requests','operation_projects','operation_delegations','operation_executors','operation_budget_reservations','operation_outcomes','measurement_imports'];
  const existing = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>).map(row=>row.name));
  const missing = required.filter(name=>!existing.has(name));
  return { required, missing, ready: missing.length === 0 };
}

function executorStatus() {
  const total = Number((sqlite.prepare('SELECT COUNT(*) AS n FROM operation_executors').get() as any)?.n ?? 0);
  const live = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM operation_executors WHERE status IN ('online','busy') AND lease_expires_at>? ").get(now()) as any)?.n ?? 0);
  const stale = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM operation_executors WHERE status IN ('online','busy') AND lease_expires_at IS NOT NULL AND lease_expires_at<=?").get(now()) as any)?.n ?? 0);
  const oldestStale = sqlite.prepare("SELECT id,status,last_seen_at,lease_expires_at FROM operation_executors WHERE status IN ('online','busy') AND lease_expires_at IS NOT NULL AND lease_expires_at<=? ORDER BY lease_expires_at LIMIT 1").get(now()) as any;
  return { total, live, stale, oldestStale: oldestStale ?? null };
}

function databaseIdentity() {
  const configured = process.env.KEYWORDS_DB_PATH?.trim() || null;
  const actual = existsSync(databasePath) ? realpathSync(databasePath) : resolve(databasePath);
  const stat = existsSync(actual) ? statSync(actual) : null;
  return { configured, actual, exists: existsSync(actual), size: stat?.size ?? null, modifiedAt: stat ? new Date(stat.mtimeMs).toISOString() : null, cwd: process.cwd(), warning: configured && resolve(configured) !== actual ? 'KEYWORDS_DB_PATH resolves to a different location than the opened database; inspect before operating.' : null };
}

export const maintenanceCommands = {
  diagnostics: async (ctx: CommandContext) => withRun(ctx, 'maintenance.diagnostics', {}, async () => {
    const [projects, keywords, jobs, sources] = await Promise.all([
      db.select({ value: count() }).from(schema.projects).get(),
      db.select({ value: count() }).from(schema.keywords).get(),
      db.select({ value: count() }).from(schema.discoveryJobs).get(),
      db.select({ value: count() }).from(schema.sources).get()
    ]);
    const backup = backupStatus(); const dbIdentity = databaseIdentity(); const schemaCheck = schemaStatus(); const executors = executorStatus();
    const apiHost = process.env.KEYWORDS_API_HOST ?? '127.0.0.1';
    const remoteHost = !['127.0.0.1','::1','localhost'].includes(apiHost);
    const humanToken = Boolean(process.env.KEYWORDS_API_HUMAN_TOKEN); const agentToken = Boolean(process.env.KEYWORDS_API_AGENT_TOKEN);
    const warnings = [
      dbIdentity.warning,
      !schemaCheck.ready ? `Missing schema tables: ${schemaCheck.missing.join(', ')}` : null,
      backup.stale ? 'No fresh database backup was found within the configured maximum age.' : null,
      executors.stale ? `${executors.stale} executor lease(s) are stale and need recovery/re-registration.` : null,
      remoteHost && !humanToken && !agentToken ? 'Remote API host has no actor tokens configured.' : null,
      remoteHost && !process.env.KEYWORDS_ALLOWED_ORIGINS ? 'Remote API host has no explicit allowed-origin list.' : null
    ].filter(Boolean);
    return {
      ok: warnings.length === 0,
      warnings,
      database: { ...databaseDiagnostics(), identity: dbIdentity, schema: schemaCheck },
      backup,
      runtime: { node: process.version, cwd: process.cwd(), platform: process.platform },
      api: { host: apiHost, remoteHost, humanTokenConfigured: humanToken, agentTokenConfigured: agentToken, allowedOriginsConfigured: Boolean(process.env.KEYWORDS_ALLOWED_ORIGINS) },
      executors,
      providers: {
        serpConfigured: Boolean(process.env.KEYWORDS_SERPER_API_KEY || process.env.SERPER_API_KEY),
        googleAdsConfigured: googleAdsConfigured(),
        searchConsoleConfigured: Boolean((process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN || process.env.GOOGLE_APPLICATION_CREDENTIALS || (process.env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN || process.env.GOOGLE_OAUTH_REFRESH_TOKEN) && (process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID || process.env.ADS_CLIENT_ID) && (process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.ADS_CLIENT_SECRET)) && process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL)
      },
      counts: { projects: Number(projects?.value ?? 0), keywords: Number(keywords?.value ?? 0), discoveryJobs: Number(jobs?.value ?? 0), sources: Number(sources?.value ?? 0) }
    };
  }),

  backup: async (ctx: CommandContext, input: { destination?: string }) => withRun(ctx, 'maintenance.backup', input, async () => {
    if (ctx.actor !== 'human') throw new Error('Database backup requires a human actor');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = input.destination?.trim() || join(process.env.KEYWORDS_BACKUP_DIR?.trim() || './data/backups', `keywords-${stamp}.sqlite`);
    return backupDatabase(target);
  })
};
