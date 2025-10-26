import type {
  GroupSummary,
  JobHistoryItem,
 ProjectSettings,
  ProjectSummary,
  ThemeSummary
} from './types';

export const projects: ProjectSummary[] = [
  {
    id: 'english-blog',
    name: '英語学習ブログ',
    domain: 'english.example.com',
    halt: false,
    lastJob: {
      status: 'succeeded',
      finishedAt: '2025-10-16T00:00:00.000Z',
      nodesProcessed: 7,
      outlinesCreated: 3
    },
    settings: createDefaultSettings()
  },
  {
    id: 'love-blog',
    name: '恋愛ブログ',
    domain: 'love.example.com',
    halt: false,
    lastJob: {
      status: 'failed',
      finishedAt: '2025-10-15T23:00:00.000Z',
      nodesProcessed: 2,
      outlinesCreated: 1
    },
    settings: createDefaultSettings({
      pipeline: {
        staleDays: 10,
        limits: {
          nodesPerRun: 6,
          ideasPerNode: 150,
          groupsOutlinePerRun: 8,
          groupsBlogPerRun: 1
        }
      },
      thresholds: { minVolume: 20, maxCompetition: 0.7 },
      links: { maxPerGroup: 4 }
    })
  }
];

export const themes: Record<string, ThemeSummary[]> = {
  'english-blog': [
    {
      id: 'conversation',
      name: '英会話',
      autoUpdate: true,
      pendingNodes: 2,
      lastUpdatedAt: '2025-10-14T12:00:00.000Z',
      settings: {
        pipeline: {
          staleDays: 12,
          limits: {
            nodesPerRun: 12,
            ideasPerNode: 220,
            groupsOutlinePerRun: 12,
            groupsBlogPerRun: 1
          }
        },
        thresholds: { minVolume: 15, maxCompetition: 0.85 },
        weights: { volume: 0.55, competition: 0.25, intent: 0.15, novelty: 0.05 },
        links: { maxPerGroup: 4 }
      }
    },
    {
      id: 'toeic',
      name: 'TOEIC 対策',
      autoUpdate: true,
      pendingNodes: 0,
      lastUpdatedAt: '2025-10-12T09:30:00.000Z'
    }
  ],
  'love-blog': [
    {
      id: 'dating',
      name: 'デートプラン',
      autoUpdate: true,
      pendingNodes: 3,
      lastUpdatedAt: '2025-10-13T15:20:00.000Z',
      settings: {
        thresholds: { minVolume: 30, maxCompetition: 0.65 },
        weights: { volume: 0.5, competition: 0.3, intent: 0.1, novelty: 0.1 }
      }
    }
  ]
};

export const groups: Record<string, GroupSummary[]> = {
  conversation: [
    {
      id: 'g1',
      title: '英会話 フレーズ 初心者',
      intent: 'info',
      priorityScore: 8.4,
      outline: {
        outlineTitle: '初心者向け英会話フレーズ集',
        h2: ['挨拶で使う定番フレーズ', '自己紹介に使える表現', 'トラブル時の英語'],
        h3: ['状況別の声掛け', 'オンライン英会話での使い方'],
        faq: [
          { q: '毎日どれくらい練習すべき？', a: '10分程度のシャドーイングを推奨します。' },
          { q: 'ネイティブらしい発音はどう磨く？', a: '短いフレーズを録音しAI添削を活用すると効率的です。' }
        ]
      },
      keywords: [
        { id: 'k1', text: '英会話 フレーズ 初心者', metrics: { avgMonthly: 1600, competition: 0.6 } },
        { id: 'k2', text: '英会話 基本表現', metrics: { avgMonthly: 880, competition: 0.5 } }
      ],
      links: [
        { targetId: 'g2', reason: 'sibling', weight: 0.64 },
        { targetId: 'g3', reason: 'hierarchy', weight: 0.52 }
      ]
    },
    {
      id: 'g2',
      title: '英会話 フレーズ ビジネス',
      intent: 'trans',
      priorityScore: 7.1,
      keywords: [
        { id: 'k3', text: 'ビジネス 英会話 フレーズ', metrics: { avgMonthly: 540, competition: 0.7 } }
      ],
      links: [{ targetId: 'g1', reason: 'sibling', weight: 0.64 }]
    }
  ],
  toeic: [
    {
      id: 'g10',
      title: 'TOEIC リスニング 対策',
      intent: 'info',
      priorityScore: 7.8,
      keywords: [
        { id: 'k20', text: 'TOEIC リスニング コツ', metrics: { avgMonthly: 1900, competition: 0.55 } }
      ],
      links: []
    }
  ],
  dating: [
    {
      id: 'g30',
      title: '初デート プラン',
      intent: 'info',
      priorityScore: 6.2,
      keywords: [
        { id: 'k40', text: '初デート 会話', metrics: { avgMonthly: 1200, competition: 0.4 } }
      ],
      links: []
    }
  ]
};

export const jobHistory: JobHistoryItem[] = [
  {
    id: 'job-1',
    type: 'daily',
    status: 'succeeded',
    startedAt: '2025-10-15T23:55:00.000Z',
    finishedAt: '2025-10-16T00:05:00.000Z',
    summary: {
      nodesProcessed: 7,
      newKeywords: 128,
      groupsCreated: 5,
      groupsUpdated: 3,
      outlinesCreated: 3,
      linksUpdated: 9
    }
  },
  {
    id: 'job-0',
    type: 'manual',
    status: 'failed',
    startedAt: '2025-10-14T02:00:00.000Z',
    finishedAt: '2025-10-14T02:04:00.000Z',
    summary: {
      nodesProcessed: 2,
      newKeywords: 30,
      groupsCreated: 1,
      groupsUpdated: 0,
      outlinesCreated: 0,
      linksUpdated: 0
    }
  }
];

function createDefaultSettings(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
  const base: ProjectSettings = {
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
  return {
    pipeline: {
      staleDays: overrides.pipeline?.staleDays ?? base.pipeline.staleDays,
      limits: {
        nodesPerRun: overrides.pipeline?.limits?.nodesPerRun ?? base.pipeline.limits.nodesPerRun,
        ideasPerNode: overrides.pipeline?.limits?.ideasPerNode ?? base.pipeline.limits.ideasPerNode,
        groupsOutlinePerRun:
          overrides.pipeline?.limits?.groupsOutlinePerRun ?? base.pipeline.limits.groupsOutlinePerRun,
        groupsBlogPerRun:
          overrides.pipeline?.limits?.groupsBlogPerRun ?? base.pipeline.limits.groupsBlogPerRun
      }
    },
    thresholds: { ...base.thresholds, ...overrides.thresholds },
    weights: { ...base.weights, ...overrides.weights },
    links: { ...base.links, ...overrides.links },
    blog: overrides.blog ?? undefined,
    blogLanguage: overrides.blogLanguage ?? base.blogLanguage
  };
}
