import { z } from 'zod';
import type { CommandContext } from '@keywords/domain';
import { readConsumerModel, searchKey, type ConsumerModel, type ConsumerPersona, type ConsumerSearchEvidence } from './consumer-model.js';

/**
 * The frame a market analysis declares before it collects anything: who it looks at (target) and
 * through which lens (viewpoint). It is read-only and computed from the model; the findings of the
 * analysis go back into the existing stores (model observedShift / searchEvidence / voices, seed pools,
 * consumer_model_observations, discovery candidates with consumerModelIds). No second state model.
 *
 * Why a fixed viewpoint vocabulary: each lens below is one that produced a finding the stock image of the
 * segment could not predict. A free-text "angle" lets an analysis drift back to the image.
 */

export const ANALYSIS_VIEWPOINTS = {
  self_search: {
    label: '本人の検索欄',
    answers: 'この人が自分で打つ語は何か。イメージに無い枝はどこか',
    collect: [
      '行動の語（動詞・事後形）を種にする。題材の名詞（不倫・上司・ランキング）から始めない',
      'scripts/suggest-soup.ts で あ〜ん 総当たり',
      '枝を self / surrounding / unknown に分ける。誰がその語を打つかで決め、字面で決めない',
    ],
    measure: ['scripts/kw-volumes.ts で量と入札レンジ', 'モデル外の人も打つ語は sideCertainty:mixed にし、量を需要に数えない'],
    stopWhen: '新しい枝を足しても side の比率と金の動く枝が変わらなくなったら止める',
    failureModes: ['種にイメージの名詞を使う', '被害側・周囲の語を self に入れる'],
  },
  life_corpus: {
    label: '生活の語',
    answers: 'この人が生活の中で打つ具体的な語は何か',
    collect: [
      'scripts/comment-corpus.ts でコメント欄を集める（ユーザー名・ID は保存しない）',
      'scripts/comment-self-lines.ts で経験の語りだけを抜き、具体物と出来事を読む',
      '断片を本人の言葉のまま scripts/suggest-soup.ts の種にする',
    ],
    measure: ['scripts/kw-volumes.ts。Ads が null でもサジェストに出た語は存在の証拠として残す'],
    stopWhen: '記事の題材を変えても新しい生活の固まりが出なくなったら止める（題材の偏りに注意）',
    failureModes: ['1人の書き込み履歴を追う（個人の特定）', '記事の題材の偏りを生活の比率と読む'],
  },
  money_moment: {
    label: '金が動く局面',
    answers: 'この人が金を出すのはどの出来事の直後か',
    collect: [
      'persona.triggers の event を起点に、事後形の語（ばれた・された・届いた・退院後）でサジェストを掘る',
      '同じ出来事の前の語（言えない・バレない）と後の語を並べ、どちらが本人側かを確かめる',
    ],
    measure: ['入札レンジが付く枝だけを Conversion の候補にする。入札ゼロは Reach として扱う'],
    stopWhen: '各 trigger について入札の有無が確定したら止める',
    failureModes: ['被害側が払う局面（請求する側の弁護士など）をこのモデルの買い手にする'],
  },
  intersection: {
    label: '生活の固まりの交点',
    answers: '同じ人の中で2つの生活の固まりが交わる点に、金の動く語はあるか',
    collect: [
      'life_corpus で出た固まりを2つ選び、片方の語のサジェストにもう片方の条件（健康状態・年齢・家族）が出るかを見る',
      '交点の語（例: 病気の後 × 住宅ローン借り換え → ワイド団信）を測る',
    ],
    measure: ['交点の語と、それぞれ単独の語の量・入札を並べる'],
    stopWhen: '主要な固まりの組み合わせを一巡したら止める',
    failureModes: ['実在の1人の事情として組み立てる', '交点を想像で作り、サジェストで存在を確かめない'],
  },
  observed_output: {
    label: '実物の観察',
    answers: 'この人が実際に何を書き・買い・選んでいるか（語られた像ではなく）',
    collect: [
      '書き込みの場（コメント欄・リプ欄・知恵袋）を読み、書き方の型と反応の数を記録する',
      '本人の一人称の投稿を voices に入れる（125字以内・URL付き・ユーザー名なし）。反する投稿も contradicts で残す',
    ],
    measure: ['型ごとの件数と分母（何件中何件か）。並び順（共感順・新着順）を明記する'],
    stopWhen: '題材を2つ以上変えても型の順位が変わらなくなったら止める',
    failureModes: ['分母を書かずに「多い」と言う', '上位だけを見て全体と読む'],
  },
  surrounding_mirror: {
    label: '周囲の目',
    answers: '周りはこの人を何と呼び、それは本人の行動とどうずれているか',
    collect: ['周囲の検索語（民度・クソリプ・専門家気取り など）をサジェストと Ads で集める'],
    measure: ['周囲の語の量は observedShift.from の根拠にだけ使う'],
    stopWhen: '周囲の呼び名が一通り出たら止める',
    failureModes: ['周囲の呼び名をそのまま人物像にする', '周囲を買い手にする（別モデル）'],
  },
} as const;

export type AnalysisViewpoint = keyof typeof ANALYSIS_VIEWPOINTS;
export type AnalysisTargetSide = 'self' | 'surrounding';

export type AnalysisFrameInput = {
  modelId: string;
  viewpoint: AnalysisViewpoint;
  /** The decision this analysis must inform. Without one, collection has no stop rule. */
  question: string;
  personaKey?: string;
  segment?: string;
  side?: AnalysisTargetSide;
};

/** Local-only context (SQLite): untested variables and the OBSERVED/REPORTED pool items tied to this model. */
export type AnalysisCoverage = {
  untestedVariables: string[];
  observationCount: number;
  poolItems?: Array<{ poolId: string; text: string; category: string | null; label: string; sourceRef: string | null }>;
} | null;

const rowSummary = (row: ConsumerSearchEvidence) => ({
  keyword: row.keyword, volume: row.volume ?? null,
  bid: row.bidLowYen != null || row.bidHighYen != null ? `${row.bidLowYen ?? '?'}〜${row.bidHighYen ?? '?'}円` : null,
  sideCertainty: row.sideCertainty ?? null, note: row.note ?? null,
});

/** Pure: builds the frame from a model. Kept pure so the smoke test can run it on a seed file. */
export function buildConsumerAnalysisFrame(model: ConsumerModel, input: AnalysisFrameInput, coverage: AnalysisCoverage = null) {
  const viewpoint = ANALYSIS_VIEWPOINTS[input.viewpoint];
  if (!viewpoint) throw new Error(`viewpoint must be one of ${Object.keys(ANALYSIS_VIEWPOINTS).join(' / ')}`);
  const question = input.question?.trim();
  if (!question) throw new Error('question is required: name the decision this analysis must inform');
  const side: AnalysisTargetSide = input.side ?? 'self';

  const personas = model.personas ?? [];
  let persona: ConsumerPersona | null = null;
  if (input.personaKey) {
    persona = personas.find(item => item.key === input.personaKey) ?? null;
    if (!persona) throw new Error(`persona ${input.personaKey} not found in ${model.id}; known: ${personas.map(item => item.key).join(', ') || '(none)'}`);
  }
  const segment = input.segment?.trim() || persona?.segment || null;

  const warnings: string[] = [];
  if (side === 'surrounding') {
    warnings.push(`side=surrounding: 周囲の人は ${model.id} の買い手ではない（buyer.doesNotPay）。この分析の結論は Conversion 計画にせず、observedShift.from の根拠か、別モデルの起点として扱う`);
  }
  if (!model.buyer) warnings.push('buyer が未設定。誰が払うかを決めてから分析する');
  if (!persona && !segment) warnings.push('ターゲットが model 全体。persona か segment を指定しないと、collect の種がイメージに戻りやすい');

  const evidence = model.searchEvidence ?? [];
  const personaWords = new Set((persona?.searchWords ?? []).map(searchKey));
  const targetRows = evidence.filter(row => row.side === side);
  const personaRows = side === 'self' && persona ? targetRows.filter(row => personaWords.has(searchKey(row.keyword))) : [];
  const countable = targetRows.filter(row => row.sideCertainty !== 'mixed');
  const mixed = targetRows.filter(row => row.sideCertainty === 'mixed');
  const withBid = evidence.filter(row => row.side === side && (row.bidHighYen ?? 0) > 0)
    .sort((a, b) => (b.bidHighYen ?? 0) - (a.bidHighYen ?? 0)).slice(0, 15);
  const voices = (model.voices ?? []).filter(voice => !persona || (voice.personaKeys ?? []).includes(persona.key));
  if (input.viewpoint === 'observed_output' && !voices.length) warnings.push('このターゲットに voices が無い。observed_output はまず本人の投稿を集めるところから始める');

  // Starting points come only from what the model already measured or recorded, never from the image.
  // Pool items are observed material (life fragments in the persona own words); hypotheses are left out.
  const lifeItems = (coverage?.poolItems ?? []).filter(item => item.label === 'OBSERVED' || item.label === 'REPORTED');
  if ((input.viewpoint === 'life_corpus' || input.viewpoint === 'intersection') && coverage && !lifeItems.length) {
    warnings.push(`${input.viewpoint}: このモデルに紐づく観測済みの seed pool が無い。life_corpus で生活の語を集めてから交点を探す`);
  }
  if (coverage && coverage.observationCount === 0) {
    warnings.push('このモデルの変数にはまだ読み（consumer_model_observe）が1件も無い。発見を definition に書くだけでなく、変数ごとの読みとして残す');
  }
  const startingPoints = {
    triggers: persona?.triggers ?? [],
    lifeClusters: Object.entries(lifeItems.reduce<Record<string, string[]>>((acc, item) => { const key = item.category ?? '(未分類)'; (acc[key] ??= []).push(item.text); return acc; }, {})).map(([cluster, items]) => ({ cluster, items })),
    measuredSelfWords: (personaRows.length ? personaRows : countable).map(row => row.keyword).slice(0, 20),
    phrases: persona?.phrases ?? [],
  };

  return {
    usage: 'analysis_frame',
    model: { id: model.id, name: model.name, version: model.version, revision: model.revision },
    target: {
      side, segment,
      persona: persona ? { key: persona.key, name: persona.name, oneLine: persona.oneLine, selfImage: persona.selfImage ?? null, isComposite: true } : null,
      buyer: model.buyer ?? null,
    },
    viewpoint: { key: input.viewpoint, ...viewpoint },
    question,
    baseline: {
      personaRows: personaRows.map(rowSummary),
      countableRows: countable.map(rowSummary),
      countableVolume: countable.reduce((sum, row) => sum + (row.volume ?? 0), 0),
      mixedRowsNotCounted: mixed.map(rowSummary),
      moneyRows: withBid.map(rowSummary),
      voices: voices.map(voice => ({ url: voice.url, quote: voice.quote, fit: voice.fit })),
      observedShift: ((model.definition as any)?.observedShift ?? []) as Array<{ from: string; to: string }>,
    },
    startingPoints,
    gaps: coverage ? { untestedVariables: coverage.untestedVariables, observationCount: coverage.observationCount } : { untestedVariables: null, note: 'coverage はローカル（SQLite）でのみ計算される' },
    rules: [
      '帰納的に進める。イメージから検索語を先に決めない。startingPoints は計測済み・記録済みのものだけ',
      'mixed の量はこのターゲットの需要に数えない',
      '買い手は buyer.pays。周囲や被害側を買い手にしない',
      '個人を特定しない。ユーザー名・ID を残さない。引用は125字以内',
      '単一の総合スコアにしない。結論ごとに根拠・反証・致命傷を書く',
    ],
    deliverables: {
      finding: '{ from（イメージ）, to（観測）, evidence[], target, viewpoint, money（入札・払う主体）, falsifier（何が出たら覆るか）, fatalFlaws[] }',
      writeBack: [
        'consumer_model_save: definition.observedShift に from→to→evidence、searchEvidence に計測行（side・sideCertainty・入札）、voices に本人の投稿',
        'consumer_model_observe: 変数・角度・thinking ごとの読み（label・分母・limitation 付き、runRef にこの分析の operation / session）',
        'consumer_seed_pool_import: 生活の語を OBSERVED（出典付き）で',
        'operation_discovery_start({ consumerModelIds: [modelId] }): 候補キーワードを前提付きで discovery へ',
      ],
    },
    warnings,
  };
}

export const consumerAnalysisFrameShape = {
  modelId: z.string().min(2).max(64),
  viewpoint: z.enum(Object.keys(ANALYSIS_VIEWPOINTS) as [AnalysisViewpoint, ...AnalysisViewpoint[]]),
  question: z.string().min(1).max(1000),
  personaKey: z.string().min(2).max(64).optional(),
  segment: z.string().max(120).optional(),
  side: z.enum(['self', 'surrounding']).optional(),
};

export const consumerAnalysisFrameCommands = {
  /**
   * Read the model (alias accepted) and return the frame. `coverage` is optional because the remote
   * runtime has no SQLite readings; the local MCP passes it from consumer_model_evidence.
   */
  frame: async (_ctx: CommandContext, input: AnalysisFrameInput, coverage: AnalysisCoverage = null) =>
    buildConsumerAnalysisFrame(await readConsumerModel(input.modelId), input, coverage),
};
