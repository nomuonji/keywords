// バズ台帳を、コンシューマーモデルの「反応・拡散側」の観測として書き戻す
//
// 使い方:
//   cd D:\youph\keywords
//   node --env-file=.env --import tsx/esm scripts/buzz-observe.ts data/experiments/<日付>/buzz [modelId] [--dry-run]
//
// 入力: corpus.json（scripts/buzz-corpus.cjs）、coded.json（結果を伏せて固定コード表で分類したもの）、
//       denominator.json（scripts/buzz-denominator.cjs）、pair_key.json + pair_pred.json（盲検テスト、任意）
// 出力: consumer_model_observe の行（ローカル SQLite）。1件ずつではなく、分母つきの集計を変数ごとに残す
//   - 購買側の検索しか持たないモデルでは、何に反応して広めるかに答えられない。その穴を埋めるための行
//   - 投稿本文は書かない。数値と型の名前だけを残す
import { readFileSync, existsSync } from 'node:fs';
import { consumerObservationCommands } from '../packages/commands/src/consumer-observation.ts';

const args = process.argv.slice(2);
const dir = args.find(arg => !arg.startsWith('--'));
const modelId = args.filter(arg => !arg.startsWith('--'))[1] ?? 'daishu-consumer';
const dryRun = args.includes('--dry-run');
if (!dir) {
  console.error('usage: buzz-observe.ts <buzz dir> [modelId] [--dry-run]');
  process.exit(1);
}
const read = (name: string) => JSON.parse(readFileSync(`${dir}/${name}`, 'utf8'));

const corpus = read('corpus.json');
const posts: any[] = corpus.posts;
const coded = new Map<string, any>(read('coded.json').map((row: any) => [row.id, row]));
const observedAt = String(corpus.fetchedAt).slice(0, 10);
const runRef = `buzz-ledger:${observedAt}`;
const population = `X検索 Top・lang:ja・いいね3,000以上・取得 ${observedAt}（${corpus.source}）`;
const SMALL = 5000;

const pct = (part: number, whole: number) => whole ? Math.round((100 * part) / whole) : 0;
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
const small = (rows: any[]) => rows.filter(post => post.followers != null && post.followers < SMALL).length;
const groupBy = (key: (row: any) => string) => {
  const groups = new Map<string, any[]>();
  for (const post of posts) {
    const name = key(post);
    groups.set(name, [...(groups.get(name) ?? []), post]);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
};
const ratio = (rows: any[], field: string) => {
  const likes = rows.reduce((sum, post) => sum + post.likes, 0);
  return likes ? (rows.reduce((sum, post) => sum + (post[field] ?? 0), 0) / likes) : 0;
};

const rows: Parameters<typeof consumerObservationCommands.record>[1][] = [];
const add = (targetKey: string, finding: string, extra: Partial<typeof rows[number]> = {}) =>
  rows.push({ modelId, targetType: 'variable', targetKey, finding, label: 'OBSERVED', observedAt, population, runRef, ...extra });

const smallCount = small(posts);
add('attention', `バズ投稿${posts.length}件のうち${smallCount}件（${pct(smallCount, posts.length)}%）がフォロワー${SMALL}人未満のアカウント。注意は、フォロワー数より投稿の中身で取られている`, {
  value: `${pct(smallCount, posts.length)}%`, denominator: `${posts.length}件`, limitation: '勝った投稿だけの集計。同じ型の当たる確率は denominator.json の行を見る'
});

const byStructure = groupBy(post => coded.get(post.id)?.structure ?? 'uncoded')
  .map(([name, group]) => `${name} ${group.length}件・小規模${pct(small(group), group.length)}%`);
add('attention', `型ごとの小規模アカウント比率（フォロワーに依存しない度合い）: ${byStructure.join(' / ')}`, {
  denominator: `${posts.length}件`, limitation: '型は結果を伏せた状態で固定コード表により1体のエージェントが分類した'
});

const byEmotion = groupBy(post => coded.get(post.id)?.emotion ?? 'uncoded');
add('emotional_reward', `感情ごとの件数と小規模アカウント比率: ${byEmotion.map(([name, group]) => `${name} ${group.length}件・小規模${pct(small(group), group.length)}%`).join(' / ')}`, {
  denominator: `${posts.length}件`, limitation: 'other が多い。感情の分類は1体のエージェントによる'
});

add('social_utility', `保存（ブックマーク÷いいね）は感情で大きく違う: ${byEmotion.map(([name, group]) => `${name} ${ratio(group, 'bookmarks').toFixed(2)}`).join(' / ')}。笑い・怒り・かわいいは、いいねで終わって保存されにくい。欲望・不安・驚きは保存される`, {
  denominator: `${posts.length}件`, limitation: 'X の bookmarks。Threads には同じ指標が無い'
});

const textOnly = posts.filter(post => !post.media.length);
add('cognitive_cost', `画像・動画なしでバズった投稿は${textOnly.length}件、本文の中央値は${median(textOnly.map(post => String(post.text).replace(/https:\/\/t\.co\/\S+/g, '').length))}字`, {
  denominator: `${textOnly.length}件`
});

const needsEvent = posts.filter(post => coded.get(post.id)?.needsRealEvent === true).length;
add('counterevidence', `${needsEvent}件（${pct(needsEvent, posts.length)}%）は実際の出来事か実際の映像がないと成立しない。架空の一人称では、この枠を再現できない`, {
  denominator: `${posts.length}件`
});

if (existsSync(`${dir}/denominator.json`)) {
  const samples = Object.entries<any[]>(read('denominator.json').samples).filter(([, list]) => list.length);
  const all = samples.flatMap(([, list]) => list);
  const hits = all.filter(post => post.likes >= 1000).length;
  add('counterevidence', `同じ型の目印（${samples.map(([marker]) => marker).join('・')}）を含む普通の投稿${all.length}件のうち、いいね1,000以上は${hits}件（${(100 * hits / all.length).toFixed(1)}%）、中央値${median(all.map(post => post.likes))}。型を真似るだけではほぼ当たらない`, {
    label: 'COUNTEREVIDENCE', denominator: `${all.length}件`, population: '同じ型の目印を含む lang:ja の投稿・成熟した1日分（Latest）'
  });
}

if (existsSync(`${dir}/pair_key.json`) && existsSync(`${dir}/pair_pred.json`)) {
  const key = new Map<string, any>(read('pair_key.json').map((row: any) => [row.code, row]));
  const predictions: any[] = read('pair_pred.json');
  const positives = predictions.filter(row => key.get(row.code)?.src === 'buzz');
  const negatives = predictions.filter(row => key.get(row.code)?.src === 'base');
  let wins = 0;
  for (const positive of positives) for (const negative of negatives) wins += positive.p > negative.p ? 1 : positive.p === negative.p ? 0.5 : 0;
  const auc = wins / (positives.length * negatives.length);
  add('attention', `文面だけでバズ${positives.length}件を普通の投稿${negatives.length}件から当てる盲検テストは AUC ${auc.toFixed(3)}。品質の下限は文面で判定できる。品質の高い投稿どうしでどれが当たるかは決まらない`, {
    label: 'OBSERVED', value: Number(auc.toFixed(3)), denominator: `${positives.length + negatives.length}件`, limitation: '負例は普通の投稿で、品質の高い非バズ投稿との比較はまだ'
  });
}

for (const row of rows) console.log(`[${row.targetKey}] ${row.finding}`);
if (dryRun) {
  console.log(`dry-run: ${rows.length} rows not written`);
} else {
  for (const row of rows) await consumerObservationCommands.record({ actor: 'agent', actorId: 'buzz-observe' } as any, row);
  console.log(`recorded ${rows.length} observations on ${modelId} (runRef ${runRef})`);
}
