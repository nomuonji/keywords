import type { Intent, ProjectSettings } from './types';

export interface ScoringInput {
  avgMonthlyVolumes: number[];
  competition: number | undefined;
  groupIntent: Intent;
  nodeIntent: Intent;
  novelty: number;
  settings: ProjectSettings;
}

function normalizeVolume(avgMonthlyVolumes: number[]): number {
  if (avgMonthlyVolumes.length === 0) {
    return 0;
  }
  const top = Math.max(...avgMonthlyVolumes);
  const scaled = Math.log1p(top);
  const maxScaled = Math.log1p(Math.max(top, 10000));
  return Math.min(1, scaled / maxScaled);
}

function normalizeCompetition(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, 1 - value));
}

function intentMatch(groupIntent: Intent, nodeIntent: Intent): number {
  if (groupIntent === nodeIntent) {
    return 1;
  }
  if (groupIntent === 'mixed' || nodeIntent === 'mixed') {
    return 0.7;
  }
  const intentPairs: Record<Intent, Intent[]> = {
    info: ['trans', 'local'],
    trans: ['info', 'local'],
    local: ['info', 'trans'],
    mixed: ['info', 'trans', 'local']
  };
  return intentPairs[groupIntent].includes(nodeIntent) ? 0.4 : 0.1;
}

export function computePriorityScore(input: ScoringInput): number {
  const {
    avgMonthlyVolumes,
    competition,
    groupIntent,
    nodeIntent,
    novelty,
    settings
  } = input;
  const v = normalizeVolume(avgMonthlyVolumes);
  const c = normalizeCompetition(competition);
  const i = intentMatch(groupIntent, nodeIntent);
  const n = Math.max(0, Math.min(1, novelty));
  const {
    weights: { volume, competition: compWeight, intent, novelty: noveltyWeight }
  } = settings;
  const score = v * volume + c * compWeight + i * intent + n * noveltyWeight;
  return Math.round(score * 1000) / 1000;
}
