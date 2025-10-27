export type { GroupDocWithId, KeywordDocWithId } from '../core';
export { runOutlineGeneration, runLinkGeneration, runBlogGeneration, runThemeRefreshInline } from './inline';
export { loadConfig } from './config';

import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../../.env')
];
const loadedEnv = new Set<string>();
for (const candidate of envCandidates) {
  const resolved = path.resolve(candidate);
  if (loadedEnv.has(resolved) || !existsSync(resolved)) {
    continue;
  }
  loadedEnv.add(resolved);
  const result = dotenv.config({ path: resolved, override: false });
  if (!result.error) {
    // eslint-disable-next-line no-console
    console.log(`Loaded environment variables from ${resolved}`);
  }
}

import { KeywordIdeaClient } from '../ads';
import { GeminiClient } from '../gemini';
import { Blogger } from '../blogger';
import { initFirestore, loadProjectContext, acquireLock, createJob, updateJobSummary } from './firestore';
import { createLogger } from './logger';
import { loadConfig } from './config';
import { runPipelineStages } from './pipeline';
import type { firestore as AdminFirestore } from 'firebase-admin';
import type { JobDoc, JobStatus, JobSummaryError } from '../core';
import type { SchedulerOptions, PipelineContext, PipelineCounters } from './types';
import { tavily } from '@tavily/core';

export async function runScheduler(options: SchedulerOptions): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(options.projectId);
  const firestore = initFirestore();
  const deps = {
    ads: new KeywordIdeaClient(config.ads),
    gemini: new GeminiClient(config.gemini),
    blogger: new Blogger(new GeminiClient(config.gemini), tavily({ apiKey: config.tavily.apiKey })),
    firestore,
    logger
  };

  const projectContext = await loadProjectContext(firestore, options);
  let lock: Awaited<ReturnType<typeof acquireLock>> | undefined;
  let job: AdminFirestore.DocumentReference<JobDoc> | undefined;

  try {
    lock = await acquireLock(firestore, options.projectId);
    job = await createJob(firestore, options.projectId, options, 'manual');

    const counters: PipelineCounters = {
      nodesProcessed: 0,
      newKeywords: 0,
      groupsCreated: 0,
      groupsUpdated: 0,
      outlinesCreated: 0,
      linksUpdated: 0,
      postsCreated: 0
    };

    const context: PipelineContext = {
      ...projectContext,
      options,
      config,
      deps,
      counters,
      job
    };

    const collectedErrors: Array<{ type: string; error: unknown }> = [];
    let fatalError: unknown;
    try {
      const stageErrors = await runPipelineStages(context);
      collectedErrors.push(...stageErrors);
    } catch (error) {
      fatalError = error;
      collectedErrors.push({ type: 'fatal', error });
    }

    const summaryErrors: JobSummaryError[] = collectedErrors.map((err) => ({
      type: err.type,
      message: `${err.error}`,
      count: 1
    }));
    const status = (collectedErrors.length ? 'error' : 'success') as JobStatus;
    await updateJobSummary(job, counters, status, summaryErrors);
    if (fatalError) {
      throw fatalError;
    }
  } finally {
    if (lock) {
      try {
        await lock.release();
      } catch (releaseError) {
        logger.warn({ error: releaseError }, 'lock_release_failed');
      }
    }
  }
}

function emitSummaryLine(
  projectId: string,
  jobId: string,
  counters: PipelineCounters,
  errors: { type: string; error: unknown }[]
) {
  const line = {
    projectId,
    jobId,
    finishedAtJst: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
    nodesProcessed: counters.nodesProcessed,
    newKeywords: counters.newKeywords,
    groupsCreated: counters.groupsCreated,
    groupsUpdated: counters.groupsUpdated,
    outlinesCreated: counters.outlinesCreated,
    linksUpdated: counters.linksUpdated,
    'summary.postsCreated': counters.postsCreated,
    errors: errors.map((err) => ({ type: err.type, message: `${err.error}` }))
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}
