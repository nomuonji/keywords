import { KeywordIdeaClient } from '@keywords/ads';
import { GeminiClient } from '@keywords/gemini';
import admin from 'firebase-admin';
import { loadConfig } from './config';
import { initFirestore, loadGroupsByIds, loadGroupsForLinking, loadProjectContext } from './firestore';
import { createLogger } from './logger';
import { mergeSettings, stageDOutline, stageEInternalLinks } from './pipeline';
import type { JobDoc } from '@keywords/core';
import type { PipelineCounters } from './types';
import type {
  GroupDocWithId,
  KeywordDocWithId
} from '@keywords/core';
import type {
  PipelineContext,
  SchedulerOptions,
  ThemeDocWithId
} from './types';

interface BaseInlineParams {
  projectId: string;
  themeId: string;
}

interface OutlineParams extends BaseInlineParams {
  groupIds?: string[];
}

interface OutlineResult {
  status: 'completed';
  outlinesCreated: number;
  outlinedGroupIds: string[];
}

interface LinkResult {
  status: 'completed';
  linksCreated: number;
  sourceGroupIds: string[];
}

interface InlineContextPayload {
  context: PipelineContext;
  theme: ThemeDocWithId;
  outlinedSources: GroupDocWithId[];
}

function createCounters(): PipelineCounters {
  return {
    nodesProcessed: 0,
    newKeywords: 0,
    groupsCreated: 0,
    groupsUpdated: 0,
    outlinesCreated: 0,
    linksUpdated: 0
  };
}

async function createInlineContext(
  params: BaseInlineParams,
  stages: SchedulerOptions['stages']
): Promise<{ context: PipelineContext; theme: ThemeDocWithId }> {
  const config = loadConfig();
  const firestore = initFirestore();
  const logger = createLogger(params.projectId);
  const deps = {
    ads: new KeywordIdeaClient(config.ads),
    gemini: new GeminiClient(config.gemini),
    firestore,
    logger
  };

  const options: SchedulerOptions = {
    projectId: params.projectId,
    themeIds: [params.themeId],
    manual: true,
    stages
  };
  const projectContext = await loadProjectContext(firestore, options);
  const theme = projectContext.themes.find((item: ThemeDocWithId) => item.id === params.themeId);
  if (!theme) {
    throw new Error(`Theme ${params.themeId} not found`);
  }

  const context: PipelineContext = {
    ...projectContext,
    options,
    config,
    deps,
    counters: createCounters(),
    job: firestore.collection(`projects/${params.projectId}/jobs`).doc(`inline_${Date.now()}`) as admin.firestore.DocumentReference<JobDoc>
  };

  return { context, theme };
}

export async function runOutlineGeneration(params: OutlineParams): Promise<OutlineResult> {
  const { context, theme } = await createInlineContext(params, {
    ideas: false,
    clustering: false,
    scoring: false,
    outline: true,
    links: false
  });
  const settings = mergeSettings(context.settings, theme.settings);
  const explicitIds = params.groupIds?.filter(
    (id): id is string => typeof id === 'string' && id.trim().length > 0
  );
  let explicitGroups: GroupDocWithId[] | undefined;
  if (explicitIds && explicitIds.length) {
    explicitGroups = await loadGroupsByIds(
      context.deps.firestore,
      params.projectId,
      params.themeId,
      explicitIds
    );
  }
  let outlined: GroupDocWithId[] = [];
  if (explicitGroups && explicitGroups.length) {
    outlined = await stageDOutline(context, theme, settings, [], {
      explicitGroups
    });
  }
  if (!outlined.length && !(explicitGroups && explicitGroups.length)) {
    const allGroups = await loadGroupsForLinking(
      context.deps.firestore,
      params.projectId,
      params.themeId
    );
    const limit = settings.pipeline.limits.groupsOutlinePerRun;
    const fallbackTargets = allGroups
      .slice()
      .filter((group) => {
        const typed = group as GroupDocWithId & {
          summaryDisabledAt?: string;
          summary?: { disabled?: boolean };
        };
        const hasActiveSummary = !!typed.summary && !typed.summary?.disabled;
        return !typed.summaryDisabledAt && !hasActiveSummary;
      })
      .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
      .slice(0, limit);
    if (fallbackTargets.length) {
      outlined = await stageDOutline(context, theme, settings, [], {
        explicitGroups: fallbackTargets
      });
    }
  }
  return {
    status: 'completed',
    outlinesCreated: context.counters.outlinesCreated,
    outlinedGroupIds: outlined.map((group) => group.id)
  };
}

async function buildOutlineSources(
  params: BaseInlineParams,
  sourceGroupIds?: string[]
): Promise<InlineContextPayload> {
  const { context, theme } = await createInlineContext(params, {
    ideas: false,
    clustering: false,
    scoring: false,
    outline: false,
    links: true
  });
  const allGroups = await loadGroupsForLinking(context.deps.firestore, params.projectId, params.themeId);
  const outlinedSources = allGroups.filter((group) => {
    if (!group.summary) {
      return false;
    }
    if (!sourceGroupIds) {
      return true;
    }
    return sourceGroupIds.includes(group.id);
  });
  return { context, theme, outlinedSources };
}

export async function runLinkGeneration(
  params: BaseInlineParams & { sourceGroupIds?: string[] }
): Promise<LinkResult> {
  const { context, theme, outlinedSources } = await buildOutlineSources(params, params.sourceGroupIds);
  if (!outlinedSources.length) {
    return { status: 'completed', linksCreated: 0, sourceGroupIds: [] };
  }
  const settings = mergeSettings(context.settings, theme.settings);
  await stageEInternalLinks(context, theme, settings, outlinedSources);

  return {
    status: 'completed',
    linksCreated: context.counters.linksUpdated,
    sourceGroupIds: outlinedSources.map((group) => group.id)
  };
}
