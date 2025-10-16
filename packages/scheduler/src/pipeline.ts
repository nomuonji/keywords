import { computePriorityScore, inferLinkReason, limitLinks, normalizeKeyword, nowIso } from '@keywords/core';
import type { GroupDoc, Intent, KeywordDoc, ProjectSettings, LinkDoc } from '@keywords/core';
import type { GroupDocWithId, KeywordDocWithId, PipelineContext, ThemeDocWithId } from './types';
import {
  fetchKeywordHashes,
  getAutoThemes,
  getEligibleNodes,
  loadGroupsForLinking,
  loadGroupsNeedingOutline,
  loadKeywordsForClustering,
  saveGroupSummary,
  saveKeywords,
  updateKeywordsAfterGrouping,
  updateNodeIdeasAt,
  upsertGroup,
  upsertLinks
} from './firestore';

interface StageError {
  type: string;
  error: unknown;
}

export async function runPipelineStages(ctx: PipelineContext): Promise<StageError[]> {
  const errors: StageError[] = [];
  try {
    const themes = await getAutoThemes(ctx.deps.firestore, ctx.projectId, ctx.options.themeIds);
    for (const theme of themes) {
      await handleTheme(ctx, theme, errors);
    }
  } catch (error) {
    ctx.deps.logger.error('pipeline_failed', { error });
    errors.push({ type: 'pipeline', error });
  }
  return errors;
}

async function handleTheme(
  ctx: PipelineContext,
  theme: ThemeDocWithId,
  errors: StageError[]
): Promise<void> {
  const themeSettings = { ...ctx.settings, ...(theme.settings ?? {}) };
  try {
    await stageAKeywordDiscovery(ctx, theme, themeSettings);
    const grouped = await stageBClustering(ctx, theme, themeSettings);
    const scoredGroups = await stageCScoring(ctx, theme, themeSettings, grouped);
    const outlined = await stageDOutline(ctx, theme, themeSettings, scoredGroups);
    await stageEInternalLinks(ctx, theme, themeSettings, outlined);
  } catch (error) {
    ctx.deps.logger.error('theme_failed', { themeId: theme.id, error });
    errors.push({ type: `theme:${theme.id}`, error });
  }
}

async function stageAKeywordDiscovery(
  ctx: PipelineContext,
  theme: ThemeDocWithId,
  settings: ProjectSettings
): Promise<void> {
  ctx.deps.logger.info('stage_a_start', { themeId: theme.id });
  const nodes = await getEligibleNodes(ctx.deps.firestore, ctx.projectId, theme.id, settings);
  ctx.counters.nodesProcessed += nodes.length;
  const existingHashes = await fetchKeywordHashes(ctx.deps.firestore, ctx.projectId, theme.id);
  for (const { id: nodeId, node } of nodes) {
    const ideas = await ctx.deps.ads.generateIdeas({ node, settings });
    const normalizedIdeas = ideas
      .map((idea) => {
        const { normalized, hash } = normalizeKeyword(idea.keyword);
        return {
          keyword: normalized,
          dedupeHash: hash,
          metrics: idea.metrics,
          sourceNodeId: nodeId
        };
      })
      .filter((item) => !existingHashes.has(item.dedupeHash));
    if (normalizedIdeas.length) {
      const saved = await saveKeywords(
        ctx.deps.firestore,
        ctx.projectId,
        theme.id,
        normalizedIdeas
      );
      ctx.counters.newKeywords += saved.length;
      normalizedIdeas.forEach((item) => existingHashes.add(item.dedupeHash));
    }
    await updateNodeIdeasAt(ctx.deps.firestore, ctx.projectId, theme.id, nodeId);
  }
  ctx.deps.logger.info('stage_a_end', { themeId: theme.id });
}

async function stageBClustering(
  ctx: PipelineContext,
  theme: ThemeDocWithId,
  settings: ProjectSettings
): Promise<GroupDocWithId[]> {
  ctx.deps.logger.info('stage_b_start', { themeId: theme.id });
  const keywords = await loadKeywordsForClustering(
    ctx.deps.firestore,
    ctx.projectId,
    theme.id
  );
  if (!keywords.length) {
    return [];
  }
  const embeddings = await ctx.deps.gemini.embed(
    keywords.map((kw) => ({ id: kw.id, text: kw.text }))
  );
  const clusters = simpleCluster(keywords, embeddings);
  const result: GroupDocWithId[] = [];
  const updates: Array<{
    id: string;
    groupId: string;
    status: KeywordDoc['status'];
    score: number;
    metrics: KeywordDoc['metrics'];
    versions: KeywordDoc['versions'];
  }> = [];

  for (const cluster of clusters) {
    const representative = selectRepresentative(cluster.keywords);
    const intent = coalesceIntent(cluster.keywords);
    const groupDoc: GroupDoc = {
      title: representative.text,
      keywords: cluster.keywords.map((kw) => kw.id),
      intent,
      summary: undefined,
      priorityScore: 0,
      clusterStats: {
        size: cluster.keywords.length,
        topKw: representative.text
      },
      updatedAt: nowIso()
    };
    const existing = cluster.keywords.find((kw) => kw.groupId);
    const saved = await upsertGroup(
      ctx.deps.firestore,
      ctx.projectId,
      theme.id,
      groupDoc,
      existing?.groupId
    );
    if (existing) {
      ctx.counters.groupsUpdated += 1;
    } else {
      ctx.counters.groupsCreated += 1;
    }
    result.push(saved);
    for (const kw of cluster.keywords) {
      updates.push({
        id: kw.id,
        groupId: saved.id,
        status: 'grouped',
        score: kw.score ?? 0,
        metrics: kw.metrics,
        versions: kw.versions
      });
    }
  }
  if (updates.length) {
    await updateKeywordsAfterGrouping(
      ctx.deps.firestore,
      ctx.projectId,
      theme.id,
      updates
    );
  }
  ctx.deps.logger.info('stage_b_end', { themeId: theme.id, clusters: clusters.length });
  return result;
}

async function stageCScoring(
  ctx: PipelineContext,
  theme: ThemeDocWithId,
  settings: ProjectSettings,
  groups: GroupDocWithId[]
): Promise<GroupDocWithId[]> {
  ctx.deps.logger.info('stage_c_start', { themeId: theme.id });
  const updated: GroupDocWithId[] = [];
  for (const group of groups) {
    const keywordDocsSnapshot = await ctx.deps.firestore
      .collection(`projects/${ctx.projectId}/themes/${theme.id}/keywords`)
      .where('groupId', '==', group.id)
      .get();
    const keywords = keywordDocsSnapshot.docs.map((doc) => doc.data() as KeywordDoc);
    const avgMonthly = keywords
      .map((kw) => kw.metrics.avgMonthly ?? 0)
      .filter((value) => value > 0);
    const competitionFirst = keywords.find((kw) => kw.metrics.competition !== undefined);
    const novelty = 1 - Math.min(1, keywords.length / 20);
    const nodeIntent = group.intent;
    const score = computePriorityScore({
      avgMonthlyVolumes: avgMonthly,
      competition: competitionFirst?.metrics.competition,
      groupIntent: group.intent,
      nodeIntent,
      novelty,
      settings
    });
    await ctx.deps.firestore
      .doc(`projects/${ctx.projectId}/themes/${theme.id}/groups/${group.id}`)
      .update({
        priorityScore: score,
        updatedAt: nowIso()
      });
    updated.push({ ...group, priorityScore: score });
  }
  ctx.deps.logger.info('stage_c_end', { themeId: theme.id, groups: updated.length });
  return updated;
}

async function stageDOutline(
  ctx: PipelineContext,
  theme: ThemeDocWithId,
  settings: ProjectSettings,
  groups: GroupDocWithId[]
): Promise<GroupDocWithId[]> {
  ctx.deps.logger.info('stage_d_start', { themeId: theme.id });
  const limit = settings.pipeline.limits.groupsOutlinePerRun;
  const toOutline = await loadGroupsNeedingOutline(
    ctx.deps.firestore,
    ctx.projectId,
    theme.id,
    limit
  );
  const selected = toOutline.slice(0, limit);
  for (const group of selected) {
    const keywordDocsSnapshot = await ctx.deps.firestore
      .collection(`projects/${ctx.projectId}/themes/${theme.id}/keywords`)
      .where('groupId', '==', group.id)
      .get();
    const keywordDocs = keywordDocsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as KeywordDoc)
    })) as KeywordDocWithId[];
    const summary = await ctx.deps.gemini.summarize({
      group,
      keywords: keywordDocs,
      settings
    });
    await saveGroupSummary(ctx.deps.firestore, ctx.projectId, theme.id, group.id, summary);
    ctx.counters.outlinesCreated += 1;
  }
  ctx.deps.logger.info('stage_d_end', { themeId: theme.id, outlined: selected.length });
  return selected;
}

async function stageEInternalLinks(
  ctx: PipelineContext,
  theme: ThemeDocWithId,
  settings: ProjectSettings,
  outlined: GroupDocWithId[]
): Promise<void> {
  ctx.deps.logger.info('stage_e_start', { themeId: theme.id });
  if (!outlined.length) {
    ctx.deps.logger.info('stage_e_end', { themeId: theme.id, links: 0 });
    return;
  }
  const allGroups = await loadGroupsForLinking(ctx.deps.firestore, ctx.projectId, theme.id);
  const candidates = buildLinkCandidates(allGroups, outlined, settings);
  const limited = limitLinks(candidates, settings);
  if (limited.length) {
    const links: LinkDoc[] = limited.map((candidate) => ({
      fromGroupId: candidate.fromGroupId,
      toGroupId: candidate.toGroupId,
      reason: candidate.reason,
      weight: candidate.topicalSimilarity * candidate.hubAuthority * candidate.targetPriority,
      updatedAt: nowIso()
    }));
    await upsertLinks(ctx.deps.firestore, ctx.projectId, theme.id, links);
    ctx.counters.linksUpdated += links.length;
  }
  ctx.deps.logger.info('stage_e_end', { themeId: theme.id, links: limited.length });
}

function simpleCluster(
  keywords: KeywordDocWithId[],
  embeddings: Array<{ id: string; vector: number[] }>
): Array<{ keywords: KeywordDocWithId[] }> {
  if (keywords.length <= 5) {
    return [{ keywords }];
  }
  const vectors = new Map(embeddings.map((item) => [item.id, item.vector]));
  const groups: KeywordDocWithId[][] = [];
  for (const keyword of keywords) {
    let assigned = false;
    for (const group of groups) {
      const sim = cosineSimilarity(vectors.get(keyword.id) ?? [], vectors.get(group[0].id) ?? []);
      if (sim >= 0.8) {
        group.push(keyword);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      groups.push([keyword]);
    }
  }
  return groups.map((keywordsGroup) => ({ keywords: keywordsGroup }));
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] ** 2;
    normB += b[i] ** 2;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function selectRepresentative(keywords: KeywordDocWithId[]): KeywordDocWithId {
  return keywords.reduce((prev, current) => {
    const prevVolume = prev.metrics.avgMonthly ?? 0;
    const currentVolume = current.metrics.avgMonthly ?? 0;
    if (currentVolume > prevVolume) {
      return current;
    }
    if (currentVolume === prevVolume && current.text.length < prev.text.length) {
      return current;
    }
    return prev;
  }, keywords[0]);
}

function coalesceIntent(keywords: KeywordDocWithId[]): Intent {
  return 'info';
}

function buildLinkCandidates(
  allGroups: GroupDocWithId[],
  outlined: GroupDocWithId[],
  settings: ProjectSettings
): Array<{
  fromGroupId: string;
  toGroupId: string;
  reason: 'hierarchy' | 'sibling' | 'hub';
  topicalSimilarity: number;
  hubAuthority: number;
  targetPriority: number;
}> {
  const outlinedSet = new Set(outlined.map((group) => group.id));
  const candidates: Array<{
    fromGroupId: string;
    toGroupId: string;
    reason: 'hierarchy' | 'sibling' | 'hub';
    topicalSimilarity: number;
    hubAuthority: number;
    targetPriority: number;
  }> = [];
  for (const source of outlined) {
    for (const target of allGroups) {
      if (source.id === target.id) continue;
      const similarity = computeGroupSimilarity(source, target);
      if (similarity < 0.4) continue;
      const hubAuthority = source.priorityScore >= target.priorityScore ? 1 : 0.7;
      const targetPriority = Math.min(1, target.priorityScore / 10);
      const reason = inferLinkReason(source, target, {
        info: 'info',
        trans: 'trans',
        local: 'local',
        mixed: 'mixed'
      });
      candidates.push({
        fromGroupId: source.id,
        toGroupId: target.id,
        reason,
        topicalSimilarity: similarity,
        hubAuthority,
        targetPriority
      });
    }
  }
  // Include high priority groups as hubs
  const highPriority = allGroups
    .filter((group) => group.priorityScore >= 7 && !outlinedSet.has(group.id))
    .slice(0, settings.links.maxPerGroup);
  for (const hub of highPriority) {
    for (const target of outlined) {
      if (hub.id === target.id) continue;
      const similarity = computeGroupSimilarity(hub, target);
      if (similarity < 0.4) continue;
      candidates.push({
        fromGroupId: hub.id,
        toGroupId: target.id,
        reason: 'hub',
        topicalSimilarity: similarity,
        hubAuthority: 1,
        targetPriority: Math.min(1, target.priorityScore / 10)
      });
    }
  }
  return candidates;
}

function computeGroupSimilarity(a: GroupDocWithId, b: GroupDocWithId): number {
  const setA = new Set(a.keywords);
  const setB = new Set(b.keywords);
  const intersection = [...setA].filter((kw) => setB.has(kw));
  const union = new Set([...a.keywords, ...b.keywords]);
  if (union.size === 0) {
    return 0;
  }
  return intersection.length / union.size;
}
