import assert from 'node:assert/strict';
import {
  appStoreRelevantForQuery,
  buildQueryIntentTree,
  classifyMarketIntent,
  type MarketIntentId
} from '../packages/commands/src/market-intelligence.js';

interface SeedCase {
  seed: string;
  primary: MarketIntentId;
  secondary?: MarketIntentId[];
  note: string;
}

const seedCases: SeedCase[] = [
  { seed: '転職', primary: 'career_qualification', note: 'career head term' },
  { seed: '簿記 資格', primary: 'career_qualification', note: 'qualification' },
  { seed: 'AWS certification', primary: 'career_qualification', note: 'English qualification' },
  { seed: 'プログラミングスクール', primary: 'career_qualification', note: 'Japanese education synonym' },
  { seed: '英会話スクール', primary: 'career_qualification', note: 'consumer education synonym' },
  { seed: '任天堂 株価', primary: 'investment', note: 'listed-company investment intent' },
  { seed: 'AI security stocks', primary: 'investment', note: 'English plural investment intent' },
  { seed: 'AIセキュリティ銘柄', primary: 'investment', note: 'Japanese investment intent' },
  { seed: 'Notion 料金', primary: 'commercial', note: 'software pricing' },
  { seed: '住宅ローン 金利', primary: 'commercial', note: 'financial product commercial evaluation' },
  { seed: '保険 見積もり', primary: 'commercial', note: 'quote/comparison transaction' },
  { seed: 'VRChat 衣装 販売', primary: 'commercial', note: 'creator-market transaction' },
  { seed: 'AGA クリニック おすすめ', primary: 'commercial', note: 'service selection' },
  { seed: '税理士 費用', primary: 'commercial', note: 'professional service price' },
  { seed: 'VPN 比較', primary: 'commercial', secondary: ['solution_product'], note: 'commercial + product' },
  { seed: 'ChatGPT 情報漏洩', primary: 'problem_need', note: 'risk/problem' },
  { seed: 'ログインできない', primary: 'problem_need', note: 'implicit failure problem' },
  { seed: '腰痛 対策', primary: 'solution_product', note: 'solution-seeking consumer need' },
  { seed: '婚活 アプリ', primary: 'solution_product', note: 'consumer app/product' },
  { seed: '動画編集 ソフト', primary: 'solution_product', note: 'software product' },
  { seed: 'Notion テンプレート', primary: 'solution_product', note: 'digital product format' },
  { seed: 'Chrome 拡張機能', primary: 'solution_product', note: 'software extension product' },
  { seed: 'Notion 使い方', primary: 'how_to', note: 'usage/how-to' },
  { seed: '副業 始め方', primary: 'how_to', note: 'start/how-to' },
  { seed: '簿記 勉強法', primary: 'how_to', note: 'study method' },
  { seed: '最新 AI ニュース', primary: 'news', note: 'news/current event' },
  { seed: 'AIセキュリティガイドライン', primary: 'research_information', note: 'guideline/informational' },
  { seed: '生成AI メリット デメリット', primary: 'research_information', note: 'pros/cons informational' },
  { seed: 'Apple Inc.', primary: 'entity', note: 'English company suffix' },
  { seed: 'AI Security 株式 会社', primary: 'entity', note: 'Japanese company spacing normalization' },
  { seed: 'AI Security LLC', primary: 'entity', note: 'English company suffix' },
  { seed: 'Security Incident INC-2026-07-28-01', primary: 'ambiguous', note: 'incident ID must not look like company Inc.' },
  { seed: 'AI security', primary: 'ambiguous', note: 'generic multi-sense term' },
  { seed: 'Apple', primary: 'ambiguous', note: 'company/fruit ambiguity' },
  { seed: 'セキュリティ', primary: 'ambiguous', note: 'broad category' },
  { seed: 'ダイエット', primary: 'ambiguous', note: 'broad consumer goal' },
  { seed: '副業', primary: 'ambiguous', note: 'broad work/income goal' },
  { seed: 'オンラインカジノ', primary: 'ambiguous', note: 'broad category without explicit intent' },
  { seed: 'Claude', primary: 'ambiguous', note: 'brand/person-name ambiguity' },
  { seed: 'rate limiting software', primary: 'solution_product', note: 'technical rate must not imply financial commercial intent' },
  { seed: 'GitHub issue tracker software', primary: 'solution_product', note: 'issue tracker is a product category, not automatically a user problem' }
];

const failures: Array<{ seed: string; expected: string; actual: string; note: string }> = [];

for (const testCase of seedCases) {
  const classification = classifyMarketIntent(testCase.seed, testCase.seed);
  if (classification.primaryIntent !== testCase.primary) {
    failures.push({
      seed: testCase.seed,
      expected: testCase.primary,
      actual: classification.primaryIntent,
      note: testCase.note
    });
    continue;
  }
  for (const expectedSecondary of testCase.secondary ?? []) {
    if (!classification.secondaryIntents.includes(expectedSecondary)) {
      failures.push({
        seed: testCase.seed,
        expected: 'secondary:' + expectedSecondary,
        actual: classification.secondaryIntents.join(',') || '(none)',
        note: testCase.note
      });
    }
  }
}

assert.deepEqual(failures, [], 'Seed classifier regression failures:\n' + JSON.stringify(failures, null, 2));

assert.equal(appStoreRelevantForQuery('AI security'), true);
assert.equal(appStoreRelevantForQuery('株価アプリ'), true);
assert.equal(appStoreRelevantForQuery('資格アプリ'), true);
assert.equal(appStoreRelevantForQuery('AIセキュリティ銘柄'), false);
assert.equal(appStoreRelevantForQuery('Apple Inc.'), false);
assert.equal(appStoreRelevantForQuery('最新AIニュース'), false);


const genericNotion = buildQueryIntentTree({
  query: 'Notion',
  relatedSearches: ['Notion 料金', 'Notion 使い方', 'Notion テンプレート', 'Notion株式会社'],
  peopleAlsoAsk: ['Notionは無料ですか？', 'Notionの使い方は？'],
  topResults: [],
  demand: []
});
assert.equal(genericNotion.queryClassification?.primaryIntent, 'ambiguous');
assert.equal(genericNotion.senseSelectionRequired, true);
assert.equal(genericNotion.branches.find(branch => branch.intent === 'commercial')?.role, 'primary');
assert.equal(genericNotion.branches.find(branch => branch.intent === 'how_to')?.role, 'primary');
assert.equal(genericNotion.branches.find(branch => branch.intent === 'solution_product')?.role, 'primary');
assert.equal(genericNotion.branches.find(branch => branch.intent === 'entity')?.role, 'out_of_scope');

const genericBookkeeping = buildQueryIntentTree({
  query: '簿記',
  relatedSearches: ['簿記 資格', '簿記 勉強法', '簿記 テキスト おすすめ'],
  peopleAlsoAsk: ['簿記資格は何級から取るべき？'],
  topResults: [],
  demand: []
});
assert.equal(genericBookkeeping.queryClassification?.primaryIntent, 'ambiguous');
assert.equal(genericBookkeeping.senseSelectionRequired, true);
assert.equal(genericBookkeeping.branches.find(branch => branch.intent === 'career_qualification')?.role, 'adjacent_market');
assert.equal(genericBookkeeping.branches.find(branch => branch.intent === 'how_to')?.role, 'primary');
assert.equal(genericBookkeeping.branches.find(branch => branch.intent === 'commercial')?.role, 'primary');

const apple = buildQueryIntentTree({
  query: 'Apple',
  relatedSearches: ['Apple 株価', 'Apple Store 価格', 'Apple Inc.', 'りんご 栄養'],
  peopleAlsoAsk: ['Appleの株価はいくら？', 'りんごの栄養は？'],
  topResults: [],
  demand: []
});
assert.equal(apple.queryClassification?.primaryIntent, 'ambiguous');
assert.equal(apple.senseSelectionRequired, true);
assert.equal(apple.branches.find(branch => branch.intent === 'investment')?.role, 'adjacent_market');
assert.equal(apple.branches.find(branch => branch.intent === 'entity')?.role, 'out_of_scope');
assert.equal(apple.branches.find(branch => branch.intent === 'commercial')?.role, 'primary');

const explicitQualification = buildQueryIntentTree({
  query: '簿記 資格',
  relatedSearches: ['簿記 資格 難易度', '簿記 勉強法', '簿記 テキスト おすすめ'],
  peopleAlsoAsk: [],
  topResults: [],
  demand: []
});
assert.deepEqual(explicitQualification.targetIntents, ['career_qualification']);
assert.equal(explicitQualification.branches.find(branch => branch.intent === 'career_qualification')?.role, 'primary');
assert.equal(explicitQualification.branches.find(branch => branch.intent === 'how_to')?.role, 'contextual');
assert.equal(explicitQualification.branches.find(branch => branch.intent === 'commercial')?.role, 'contextual');

const explicitInvestment = buildQueryIntentTree({
  query: '任天堂 株価',
  relatedSearches: ['任天堂 株価 今後', '任天堂 ゲーム おすすめ'],
  peopleAlsoAsk: [],
  topResults: [],
  demand: []
});
assert.deepEqual(explicitInvestment.targetIntents, ['investment']);
assert.equal(explicitInvestment.branches.find(branch => branch.intent === 'investment')?.role, 'primary');
assert.equal(explicitInvestment.branches.find(branch => branch.intent === 'commercial')?.role, 'contextual');

console.log('market intent regression smoke passed:', {
  seedCases: seedCases.length,
  treeCases: 5,
  categories: [
    'career/qualification',
    'investment',
    'commercial',
    'problem',
    'solution/product',
    'how-to',
    'news',
    'research',
    'entity',
    'ambiguous/polysemy'
  ]
});
