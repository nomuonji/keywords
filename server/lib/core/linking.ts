import type { GroupDoc, Intent, ProjectSettings } from './types';

export interface LinkCandidate {
  fromGroupId: string;
  toGroupId: string;
  reason: 'hierarchy' | 'sibling' | 'hub';
  topicalSimilarity: number;
  hubAuthority: number;
  targetPriority: number;
}

export function computeLinkWeight(candidate: LinkCandidate): number {
  const { topicalSimilarity, hubAuthority, targetPriority } = candidate;
  const weight = topicalSimilarity * hubAuthority * targetPriority;
  return Math.round(weight * 1000) / 1000;
}

export function inferLinkReason(
  source: GroupDoc,
  target: GroupDoc,
  intents: Record<string, Intent>
): 'hierarchy' | 'sibling' | 'hub' {
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

export function limitLinks<T extends LinkCandidate>(
  candidates: T[],
  settings: ProjectSettings
): T[] {
  const max = settings.links.maxPerGroup;
  const grouped = new Map<string, T[]>();
  for (const candidate of candidates) {
    const arr = grouped.get(candidate.fromGroupId) ?? [];
    arr.push(candidate);
    grouped.set(candidate.fromGroupId, arr);
  }
  const result: T[] = [];
  for (const arr of grouped.values()) {
    const sorted = arr.sort((a, b) => computeLinkWeight(b) - computeLinkWeight(a));
    result.push(...sorted.slice(0, max));
  }
  return result;
}
