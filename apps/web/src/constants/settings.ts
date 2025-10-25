import type { ProjectSettings } from '../types';

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  pipeline: {
    staleDays: 14,
    limits: {
      nodesPerRun: 10,
      ideasPerNode: 200,
      groupsOutlinePerRun: 10,
      groupsBlogPerRun: 1
    }
  },
  thresholds: {
    minVolume: 10,
    maxCompetition: 0.8
  },
  weights: {
    volume: 0.5,
    competition: 0.3,
    intent: 0.15,
    novelty: 0.05
  },
  links: {
    maxPerGroup: 3
  },
  blogLanguage: 'ja'
};
