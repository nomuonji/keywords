import { KeywordIdeaClient } from '@keywords/ads';
import { GeminiClient } from '@keywords/gemini';
import { initFirestore, loadProjectContext, acquireLock, createJob, updateJobSummary } from './firestore';
import { createLogger } from './logger';
import { loadConfig } from './config';
import { runPipelineStages } from './pipeline';
import type { PipelineContext, PipelineCounters, SchedulerOptions } from './types';

export async function runScheduler(options: SchedulerOptions): Promise<void> {
  const config = loadConfig();
  const firestore = initFirestore();
  if (config.firestore.databaseId) {
    firestore.settings({ databaseId: config.firestore.databaseId });
  }
  const projectContext = await loadProjectContext(firestore, options);
  if (projectContext.project.halt) {
    const logger = createLogger(options.projectId);
    logger.warn('project_halted', { projectId: options.projectId });
    return;
  }
  const lock = await acquireLock(firestore, options.projectId);
  const jobRef = await createJob(
    firestore,
    options.projectId,
    { projectId: options.projectId, themeIds: options.themeIds },
    options.manual ? 'manual' : 'daily'
  );
  await lock.ref.update({ jobId: jobRef.id });
  const counters: PipelineCounters = {
    nodesProcessed: 0,
    newKeywords: 0,
    groupsCreated: 0,
    groupsUpdated: 0,
    outlinesCreated: 0,
    linksUpdated: 0
  };
  const logger = createLogger(options.projectId);
  const adsClient = new KeywordIdeaClient(config.ads);
  const geminiClient = new GeminiClient(config.gemini);

  const ctx: PipelineContext = {
    ...projectContext,
    options,
    deps: {
      firestore,
      ads: {
        generateIdeas: async ({ node, settings }) => {
          return adsClient.generateKeywordIdeas({
            projectId: options.projectId,
            seedText: node.title,
            locale: 'ja',
            locationIds: settings.ads.locationIds,
            languageId: settings.ads.languageId,
            maxResults: settings.pipeline.limits.ideasPerNode,
            minVolume: settings.thresholds.minVolume,
            maxCompetition: settings.thresholds.maxCompetition
          });
        }
      },
      gemini: {
        embed: (keywords) =>
          geminiClient.embedKeywords({
            projectId: options.projectId,
            keywords
          }),
        summarize: ({ group, keywords, settings }) =>
          geminiClient.summarizeCluster({
            groupId: group.id,
            representativeKw: group.title,
            intent: group.intent,
            description: `Keywords: ${keywords.map((kw) => kw.text).join(', ')}`,
            keywords: keywords.map((kw) => ({ text: kw.text, metrics: kw.metrics })),
            settings
          }),
        classifyIntent: (text) => geminiClient.classifyIntent(text)
      },
      logger
    },
    counters,
    jobRef
  };

  let errors: { type: string; error: unknown }[] = [];
  let status: 'succeeded' | 'failed' = 'succeeded';
  try {
    errors = await runPipelineStages(ctx);
    if (errors.length) {
      status = 'failed';
    }
  } catch (error) {
    logger.error('pipeline_run_error', { error });
    errors.push({ type: 'fatal', error });
    status = 'failed';
  } finally {
    await updateJobSummary(
      jobRef,
      counters,
      status,
      errors.map((e) => ({
        type: e.type,
        count: 1
      }))
    );
    await lock.release();
    emitSummaryLine(options.projectId, jobRef.id, counters, errors);
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
    errors: errors.map((err) => ({ type: err.type, message: `${err.error}` }))
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}
