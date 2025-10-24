"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = exports.runLinkGeneration = exports.runOutlineGeneration = void 0;
exports.runScheduler = runScheduler;
var inline_1 = require("./inline");
Object.defineProperty(exports, "runOutlineGeneration", { enumerable: true, get: function () { return inline_1.runOutlineGeneration; } });
Object.defineProperty(exports, "runLinkGeneration", { enumerable: true, get: function () { return inline_1.runLinkGeneration; } });
var config_1 = require("./config");
Object.defineProperty(exports, "loadConfig", { enumerable: true, get: function () { return config_1.loadConfig; } });
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const dotenv_1 = __importDefault(require("dotenv"));
const envCandidates = [
    node_path_1.default.resolve(process.cwd(), '.env'),
    node_path_1.default.resolve(__dirname, '../../.env'),
    node_path_1.default.resolve(__dirname, '../../../.env')
];
const loadedEnv = new Set();
for (const candidate of envCandidates) {
    const resolved = node_path_1.default.resolve(candidate);
    if (loadedEnv.has(resolved) || !(0, node_fs_1.existsSync)(resolved)) {
        continue;
    }
    loadedEnv.add(resolved);
    const result = dotenv_1.default.config({ path: resolved, override: false });
    if (!result.error) {
        // eslint-disable-next-line no-console
        console.log(`Loaded environment variables from ${resolved}`);
    }
}
const ads_1 = require("@keywords/ads");
const gemini_1 = require("@keywords/gemini");
const firestore_1 = require("./firestore");
const logger_1 = require("./logger");
const config_2 = require("./config");
const pipeline_1 = require("./pipeline");
async function runScheduler(options) {
    const config = (0, config_2.loadConfig)();
    const logger = (0, logger_1.createLogger)(options.projectId);
    const firestore = (0, firestore_1.initFirestore)();
    const deps = {
        ads: new ads_1.KeywordIdeaClient(config.ads),
        gemini: new gemini_1.GeminiClient(config.gemini),
        firestore,
        logger
    };
    const projectContext = await (0, firestore_1.loadProjectContext)(firestore, options);
    let lock;
    let job;
    try {
        lock = await (0, firestore_1.acquireLock)(firestore, options.projectId);
        job = await (0, firestore_1.createJob)(firestore, options.projectId, options, 'manual');
        const counters = {
            nodesProcessed: 0,
            newKeywords: 0,
            groupsCreated: 0,
            groupsUpdated: 0,
            outlinesCreated: 0,
            linksUpdated: 0
        };
        const context = {
            ...projectContext,
            options,
            config,
            deps,
            counters,
            job
        };
        const collectedErrors = [];
        let fatalError;
        try {
            const stageErrors = await (0, pipeline_1.runPipelineStages)(context);
            collectedErrors.push(...stageErrors);
        }
        catch (error) {
            fatalError = error;
            collectedErrors.push({ type: 'fatal', error });
        }
        const summaryErrors = collectedErrors.map((err) => ({
            type: err.type,
            message: `${err.error}`,
            count: 1
        }));
        const status = (collectedErrors.length ? 'error' : 'success');
        await (0, firestore_1.updateJobSummary)(job, counters, status, summaryErrors);
        if (fatalError) {
            throw fatalError;
        }
    }
    finally {
        if (lock) {
            try {
                await lock.release();
            }
            catch (releaseError) {
                logger.warn({ error: releaseError }, 'lock_release_failed');
            }
        }
    }
}
function emitSummaryLine(projectId, jobId, counters, errors) {
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
