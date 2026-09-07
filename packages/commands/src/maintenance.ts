import { count } from 'drizzle-orm';
import { backupDatabase, databaseDiagnostics, getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';

const { db } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

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

export const maintenanceCommands = {
  diagnostics: async (ctx: CommandContext) => withRun(ctx, 'maintenance.diagnostics', {}, async () => {
    const [projects, keywords, jobs, sources] = await Promise.all([
      db.select({ value: count() }).from(schema.projects).get(),
      db.select({ value: count() }).from(schema.keywords).get(),
      db.select({ value: count() }).from(schema.discoveryJobs).get(),
      db.select({ value: count() }).from(schema.sources).get()
    ]);
    return {
      database: databaseDiagnostics(),
      runtime: { node: process.version, cwd: process.cwd(), platform: process.platform },
      providers: {
        serpConfigured: Boolean(process.env.KEYWORDS_SERPER_API_KEY || process.env.SERPER_API_KEY),
        googleAdsConfigured: Boolean((process.env.GOOGLE_ADS_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN) && process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_CUSTOMER_ID),
        searchConsoleConfigured: Boolean((process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN) && process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL)
      },
      counts: { projects: Number(projects?.value ?? 0), keywords: Number(keywords?.value ?? 0), discoveryJobs: Number(jobs?.value ?? 0), sources: Number(sources?.value ?? 0) }
    };
  }),

  backup: async (ctx: CommandContext, input: { destination?: string }) => withRun(ctx, 'maintenance.backup', input, async () => {
    if (ctx.actor !== 'human') throw new Error('Database backup requires a human actor');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return backupDatabase(input.destination?.trim() || `./data/backups/keywords-${stamp}.sqlite`);
  })
};
