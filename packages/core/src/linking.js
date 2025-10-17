"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeLinkWeight = computeLinkWeight;
exports.inferLinkReason = inferLinkReason;
exports.limitLinks = limitLinks;
function computeLinkWeight(candidate) {
    const { topicalSimilarity, hubAuthority, targetPriority } = candidate;
    const weight = topicalSimilarity * hubAuthority * targetPriority;
    return Math.round(weight * 1000) / 1000;
}
function inferLinkReason(source, target, intents) {
    const sourceIntent = intents[source.intent] ?? source.intent;
    const targetIntent = intents[target.intent] ?? target.intent;
    if (sourceIntent === targetIntent && source.clusterStats.size === 0) {
        return 'hub';
    }
    if (sourceIntent === targetIntent) {
        return 'sibling';
    }
    return 'hierarchy';
}
function limitLinks(candidates, settings) {
    const max = settings.links.maxPerGroup;
    const grouped = new Map();
    for (const candidate of candidates) {
        const arr = grouped.get(candidate.fromGroupId) ?? [];
        arr.push(candidate);
        grouped.set(candidate.fromGroupId, arr);
    }
    const result = [];
    for (const arr of grouped.values()) {
        const sorted = arr.sort((a, b) => computeLinkWeight(b) - computeLinkWeight(a));
        result.push(...sorted.slice(0, max));
    }
    return result;
}
