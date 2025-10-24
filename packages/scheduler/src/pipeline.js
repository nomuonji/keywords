"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeSettings = mergeSettings;
exports.runPipelineStages = runPipelineStages;
exports.stageDOutline = stageDOutline;
exports.stageEInternalLinks = stageEInternalLinks;
const core_1 = require("@keywords/core");
const firestore_1 = require("./firestore");
function mergeSettings(base, overrides) {
    if (!overrides) {
        return { ...base };
    }
    const thresholds = overrides.thresholds ?? {};
    const overrideAds = {
        ...(overrides.ads ?? {}),
        ...(thresholds.minVolume !== undefined ? { minVolume: thresholds.minVolume } : {}),
        ...(thresholds.maxCompetition !== undefined ? { maxCompetition: thresholds.maxCompetition } : {})
    };
    const merged = {
        ...base,
        ...overrides,
        pipeline: {
            ...base.pipeline,
            ...(overrides.pipeline ?? {}),
            limits: {
                ...base.pipeline.limits,
                ...(overrides.pipeline?.limits ?? {})
            }
        },
        ads: {
            ...base.ads,
            ...overrideAds
        },
        weights: {
            ...base.weights,
            ...(overrides.weights ?? {})
        },
        links: {
            ...base.links,
            ...(overrides.links ?? {})
        }
    };
    if (!merged.projectId) {
        merged.projectId = base.projectId;
    }
    if (!merged.ads.maxResults) {
        merged.ads.maxResults = merged.pipeline.limits.ideasPerNode;
    }
    return merged;
}
function resolveStageFlags(stages) {
    return {
        ideas: stages?.ideas ?? true,
        clustering: stages?.clustering ?? true,
        scoring: stages?.scoring ?? true,
        outline: stages?.outline ?? true,
        links: stages?.links ?? true
    };
}
async function runPipelineStages(ctx) {
    const errors = [];
    try {
        const stageFlags = resolveStageFlags(ctx.options.stages);
        const themes = await (0, firestore_1.getAutoThemes)(ctx.deps.firestore, ctx.projectId, ctx.options.themeIds);
        for (const theme of themes) {
            await handleTheme(ctx, theme, stageFlags, errors);
        }
    }
    catch (error) {
        ctx.deps.logger.error({ err: error instanceof Error ? error : undefined, error }, 'pipeline_failed');
        errors.push({ type: 'pipeline', error });
    }
    return errors;
}
async function handleTheme(ctx, theme, stages, errors) {
    const themeSettings = mergeSettings(ctx.settings, theme.settings);
    try {
        if (stages.ideas) {
            await stageAKeywordDiscovery(ctx, theme, themeSettings);
        }
        else {
            ctx.deps.logger.info({ themeId: theme.id }, 'stage_a_skipped');
        }
        let clusteredGroups = [];
        if (stages.clustering) {
            clusteredGroups = await stageBClustering(ctx, theme, themeSettings);
        }
        else {
            ctx.deps.logger.info({ themeId: theme.id }, 'stage_b_skipped');
        }
        let scoredGroups = clusteredGroups;
        if (stages.scoring && clusteredGroups.length) {
            scoredGroups = await stageCScoring(ctx, theme, themeSettings, clusteredGroups);
        }
        else if (!stages.scoring) {
            ctx.deps.logger.info({ themeId: theme.id }, 'stage_c_skipped');
        }
        let outlined = [];
        if (stages.outline) {
            outlined = await stageDOutline(ctx, theme, themeSettings, scoredGroups);
        }
        else {
            ctx.deps.logger.info({ themeId: theme.id }, 'stage_d_skipped');
        }
        if (stages.links) {
            await stageEInternalLinks(ctx, theme, themeSettings, outlined);
        }
        else {
            ctx.deps.logger.info({ themeId: theme.id }, 'stage_e_skipped');
        }
    }
    catch (error) {
        ctx.deps.logger.error({ themeId: theme.id, err: error instanceof Error ? error : undefined, error }, 'theme_failed');
        errors.push({ type: `theme:${theme.id}`, error });
    }
}
async function stageAKeywordDiscovery(ctx, theme, settings) {
    ctx.deps.logger.info({ themeId: theme.id }, 'stage_a_start');
    const nodes = await (0, firestore_1.getEligibleNodes)(ctx.deps.firestore, ctx.projectId, theme.id, settings);
    ctx.counters.nodesProcessed += nodes.length;
    const existingHashes = await (0, firestore_1.fetchKeywordHashes)(ctx.deps.firestore, ctx.projectId, theme.id);
    for (const { id: nodeId, node } of nodes) {
        let ideas;
        try {
            ideas = await ctx.deps.ads.generateIdeas({ node, settings });
        }
        catch (error) {
            ctx.deps.logger.error({ themeId: theme.id, nodeId, error: error instanceof Error ? { message: error.message, stack: error.stack } : error }, 'keyword_idea_failed');
            continue;
        }
        const normalizedIdeas = ideas
            .map((idea) => {
            const { normalized, hash } = (0, core_1.normalizeKeyword)(idea.keyword);
            return {
                keyword: normalized,
                dedupeHash: hash,
                metrics: idea.metrics,
                sourceNodeId: nodeId
            };
        })
            .filter((item) => !existingHashes.has(item.dedupeHash));
        if (normalizedIdeas.length) {
            const saved = await (0, firestore_1.saveKeywords)(ctx.deps.firestore, ctx.projectId, theme.id, normalizedIdeas);
            ctx.counters.newKeywords += saved.length;
            normalizedIdeas.forEach((item) => existingHashes.add(item.dedupeHash));
        }
        await (0, firestore_1.updateNodeIdeasAt)(ctx.deps.firestore, ctx.projectId, theme.id, nodeId);
    }
    ctx.deps.logger.info({ themeId: theme.id }, 'stage_a_end');
}
async function stageBClustering(ctx, theme, settings) {
    ctx.deps.logger.info({ themeId: theme.id }, 'stage_b_start');
    const keywords = await (0, firestore_1.loadKeywordsForClustering)(ctx.deps.firestore, ctx.projectId, theme.id);
    if (!keywords.length) {
        return [];
    }
    const embeddings = await ctx.deps.gemini.embed(keywords.map((kw) => ({ id: kw.id, text: kw.text })));
    const clusters = simpleCluster(keywords, embeddings);
    const result = [];
    const updates = [];
    for (const cluster of clusters) {
        const representative = selectRepresentative(cluster.keywords);
        const intent = coalesceIntent(cluster.keywords);
        const groupDoc = {
            title: representative.text,
            keywords: cluster.keywords.map((kw) => kw.id),
            intent,
            priorityScore: 0,
            clusterStats: {
                size: cluster.keywords.length,
                topKw: representative.text
            },
            updatedAt: (0, core_1.nowIso)()
        };
        const existing = cluster.keywords.find((kw) => kw.groupId);
        const saved = await (0, firestore_1.upsertGroup)(ctx.deps.firestore, ctx.projectId, theme.id, groupDoc, existing?.groupId);
        if (existing) {
            ctx.counters.groupsUpdated += 1;
        }
        else {
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
        await (0, firestore_1.updateKeywordsAfterGrouping)(ctx.deps.firestore, ctx.projectId, theme.id, updates);
    }
    ctx.deps.logger.info({ themeId: theme.id, clusters: clusters.length }, 'stage_b_end');
    return result;
}
async function stageCScoring(ctx, theme, settings, groups) {
    ctx.deps.logger.info({ themeId: theme.id }, 'stage_c_start');
    const updated = [];
    for (const group of groups) {
        const keywordDocsSnapshot = await ctx.deps.firestore
            .collection(`projects/${ctx.projectId}/themes/${theme.id}/keywords`)
            .where('groupId', '==', group.id)
            .get();
        const keywords = keywordDocsSnapshot.docs.map((doc) => doc.data());
        const avgMonthly = keywords
            .map((kw) => kw.metrics.avgMonthly ?? 0)
            .filter((value) => value > 0);
        const competitionFirst = keywords.find((kw) => kw.metrics.competition !== undefined);
        const novelty = 1 - Math.min(1, keywords.length / 20);
        const nodeIntent = group.intent;
        const score = (0, core_1.computePriorityScore)({
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
            updatedAt: (0, core_1.nowIso)()
        });
        updated.push({ ...group, priorityScore: score });
    }
    ctx.deps.logger.info({ themeId: theme.id, groups: updated.length }, 'stage_c_end');
    return updated;
}
async function stageDOutline(ctx, theme, settings, groups, options) {
    ctx.deps.logger.info({ themeId: theme.id }, 'stage_d_start');
    const limit = settings.pipeline.limits.groupsOutlinePerRun;
    let selected = [];
    if (options?.explicitGroups?.length) {
        selected = options.explicitGroups.slice(0, limit);
    }
    else {
        const toOutline = await (0, firestore_1.loadGroupsNeedingOutline)(ctx.deps.firestore, ctx.projectId, theme.id, limit);
        selected = toOutline.slice(0, limit);
    }
    if (!selected.length) {
        ctx.deps.logger.info({ themeId: theme.id, outlined: 0 }, 'stage_d_end');
        return [];
    }
    for (const group of selected) {
        const keywordDocsSnapshot = await ctx.deps.firestore
            .collection(`projects/${ctx.projectId}/themes/${theme.id}/keywords`)
            .where('groupId', '==', group.id)
            .get();
        const keywordDocs = keywordDocsSnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data()
        }));
        const summary = await ctx.deps.gemini.summarize({
            group,
            keywords: keywordDocs,
            settings
        });
        try {
            await (0, firestore_1.saveGroupSummary)(ctx.deps.firestore, ctx.projectId, theme.id, group.id, summary);
            ctx.counters.outlinesCreated += 1;
        }
        catch (error) {
            if (error.code === 5) {
                ctx.deps.logger.warn({ themeId: theme.id, groupId: group.id, error }, 'group_missing_skipping_outline');
                continue;
            }
            throw error;
        }
    }
    ctx.deps.logger.info({ themeId: theme.id, outlined: selected.length }, 'stage_d_end');
    return selected;
}
async function stageEInternalLinks(ctx, theme, settings, outlined) {
    ctx.deps.logger.info({ themeId: theme.id }, 'stage_e_start');
    if (!outlined.length) {
        ctx.deps.logger.info({ themeId: theme.id, links: 0 }, 'stage_e_end');
        return;
    }
    const allGroups = await (0, firestore_1.loadGroupsForLinking)(ctx.deps.firestore, ctx.projectId, theme.id);
    const candidates = buildLinkCandidates(allGroups, outlined, settings);
    const limited = (0, core_1.limitLinks)(candidates, settings);
    if (limited.length) {
        const links = limited.map((candidate) => ({
            fromGroupId: candidate.fromGroupId,
            toGroupId: candidate.toGroupId,
            reason: candidate.reason,
            weight: candidate.topicalSimilarity * candidate.hubAuthority * candidate.targetPriority,
            updatedAt: (0, core_1.nowIso)()
        }));
        await (0, firestore_1.upsertLinks)(ctx.deps.firestore, ctx.projectId, theme.id, links);
        ctx.counters.linksUpdated += links.length;
    }
    ctx.deps.logger.info({ themeId: theme.id, links: limited.length }, 'stage_e_end');
}
function simpleCluster(keywords, embeddings) {
    if (keywords.length <= 5) {
        return [{ keywords }];
    }
    const vectors = new Map(embeddings.map((item) => [item.id, item.vector]));
    const groups = [];
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
function cosineSimilarity(a, b) {
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
function selectRepresentative(keywords) {
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
function coalesceIntent(keywords) {
    return 'info';
}
function buildLinkCandidates(allGroups, outlined, settings) {
    const outlinedSet = new Set(outlined.map((group) => group.id));
    const candidates = [];
    for (const source of outlined) {
        for (const target of allGroups) {
            if (source.id === target.id)
                continue;
            const similarity = computeGroupSimilarity(source, target);
            if (similarity < 0.4)
                continue;
            const hubAuthority = source.priorityScore >= target.priorityScore ? 1 : 0.7;
            const targetPriority = Math.min(1, target.priorityScore / 10);
            const reason = (0, core_1.inferLinkReason)(source, target, {
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
            if (hub.id === target.id)
                continue;
            const similarity = computeGroupSimilarity(hub, target);
            if (similarity < 0.4)
                continue;
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
    if (!candidates.length) {
        const fallbackTargets = allGroups
            .filter((group) => !outlinedSet.has(group.id))
            .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
            .slice(0, settings.links.maxPerGroup);
        for (const source of outlined) {
            for (const target of fallbackTargets) {
                if (source.id === target.id) {
                    continue;
                }
                candidates.push({
                    fromGroupId: source.id,
                    toGroupId: target.id,
                    reason: 'sibling',
                    topicalSimilarity: 0.2,
                    hubAuthority: 1,
                    targetPriority: Math.min(1, (target.priorityScore ?? 0) / 10)
                });
            }
        }
    }
    return candidates;
}
function computeGroupSimilarity(a, b) {
    const setA = new Set(a.keywords);
    const setB = new Set(b.keywords);
    const intersection = [...setA].filter((kw) => setB.has(kw));
    const union = new Set([...a.keywords, ...b.keywords]);
    if (union.size === 0) {
        return 0;
    }
    return intersection.length / union.size;
}
