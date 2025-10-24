"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOutlineGeneration = runOutlineGeneration;
exports.runLinkGeneration = runLinkGeneration;
const ads_1 = require("@keywords/ads");
const gemini_1 = require("@keywords/gemini");
const config_1 = require("./config");
const firestore_1 = require("./firestore");
const logger_1 = require("./logger");
const pipeline_1 = require("./pipeline");
function createCounters() {
    return {
        nodesProcessed: 0,
        newKeywords: 0,
        groupsCreated: 0,
        groupsUpdated: 0,
        outlinesCreated: 0,
        linksUpdated: 0
    };
}
async function createInlineContext(params, stages) {
    const config = (0, config_1.loadConfig)();
    const firestore = (0, firestore_1.initFirestore)();
    const logger = (0, logger_1.createLogger)(params.projectId);
    const deps = {
        ads: new ads_1.KeywordIdeaClient(config.ads),
        gemini: new gemini_1.GeminiClient(config.gemini),
        firestore,
        logger
    };
    const options = {
        projectId: params.projectId,
        themeIds: [params.themeId],
        manual: true,
        stages
    };
    const projectContext = await (0, firestore_1.loadProjectContext)(firestore, options);
    const theme = projectContext.themes.find((item) => item.id === params.themeId);
    if (!theme) {
        throw new Error(`Theme ${params.themeId} not found`);
    }
    const context = {
        ...projectContext,
        options,
        config,
        deps,
        counters: createCounters(),
        job: firestore.collection(`projects/${params.projectId}/jobs`).doc(`inline_${Date.now()}`)
    };
    return { context, theme };
}
async function runOutlineGeneration(params) {
    const { context, theme } = await createInlineContext(params, {
        ideas: false,
        clustering: false,
        scoring: false,
        outline: true,
        links: false
    });
    const settings = (0, pipeline_1.mergeSettings)(context.settings, theme.settings);
    const explicitIds = params.groupIds?.filter((id) => typeof id === 'string' && id.trim().length > 0);
    let explicitGroups;
    if (explicitIds && explicitIds.length) {
        explicitGroups = await (0, firestore_1.loadGroupsByIds)(context.deps.firestore, params.projectId, params.themeId, explicitIds);
    }
    let outlined = [];
    if (explicitGroups && explicitGroups.length) {
        outlined = await (0, pipeline_1.stageDOutline)(context, theme, settings, [], {
            explicitGroups
        });
    }
    if (!outlined.length && !(explicitGroups && explicitGroups.length)) {
        const allGroups = await (0, firestore_1.loadGroupsForLinking)(context.deps.firestore, params.projectId, params.themeId);
        const limit = settings.pipeline.limits.groupsOutlinePerRun;
        const fallbackTargets = allGroups
            .slice()
            .filter((group) => {
            const typed = group;
            const hasActiveSummary = !!typed.summary && !typed.summary?.disabled;
            return !typed.summaryDisabledAt && !hasActiveSummary;
        })
            .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
            .slice(0, limit);
        if (fallbackTargets.length) {
            outlined = await (0, pipeline_1.stageDOutline)(context, theme, settings, [], {
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
async function buildOutlineSources(params, sourceGroupIds) {
    const { context, theme } = await createInlineContext(params, {
        ideas: false,
        clustering: false,
        scoring: false,
        outline: false,
        links: true
    });
    const allGroups = await (0, firestore_1.loadGroupsForLinking)(context.deps.firestore, params.projectId, params.themeId);
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
async function runLinkGeneration(params) {
    const { context, theme, outlinedSources } = await buildOutlineSources(params, params.sourceGroupIds);
    if (!outlinedSources.length) {
        return { status: 'completed', linksCreated: 0, sourceGroupIds: [] };
    }
    const settings = (0, pipeline_1.mergeSettings)(context.settings, theme.settings);
    await (0, pipeline_1.stageEInternalLinks)(context, theme, settings, outlinedSources);
    return {
        status: 'completed',
        linksCreated: context.counters.linksUpdated,
        sourceGroupIds: outlinedSources.map((group) => group.id)
    };
}
