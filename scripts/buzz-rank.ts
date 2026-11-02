// 下書き候補を、バズ台帳で当たり外れの分かっている投稿に混ぜて盲検で順位付けする
//
// 使い方（2段階。間に「見ていない審査役」が rank_blind.json だけを読んで rank_pred.json を書く）:
//   cd D:\youph\keywords
//   node --import tsx/esm scripts/buzz-rank.ts pool  <candidates.json> <buzz dir> [--hidden 8] [--offset 0]
//   node --import tsx/esm scripts/buzz-rank.ts score <candidates.json>
//
// pool : candidates.json と同じフォルダに rank_blind.json（code と本文だけ）と rank_key.json（正体）を書く。
//        当たり（corpus.json の文字だけの身内・目撃・一行 × 笑い・共感・怒り）と、外れ（denominator.json）を
//        同数ずつ伏せて混ぜる。審査役に渡すのは rank_blind.json だけ
// score: rank_pred.json（{code, p, why}[]）を読み、伏せた既知の投稿で今回の審査役の AUC を出し、
//        候補を p の高い順に並べる。AUC が 0.8 を下回った回は、順位を信用しない
//   - 審査役が見分けられるのは品質の下限まで。品質の高い候補どうしの当たり外れは、実地の投稿で決める
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const [mode, candidatesPath, buzzDir] = process.argv.slice(2);
const option = (name: string, fallback: number) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? Number(process.argv[index + 1]) : fallback;
};
if (!mode || !candidatesPath || (mode === 'pool' && !buzzDir)) {
  console.error('usage: buzz-rank.ts pool <candidates.json> <buzz dir> [--hidden 8] | score <candidates.json>');
  process.exit(1);
}
const dir = dirname(candidatesPath);
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const clean = (text: string) => text.replace(/https:\/\/t\.co\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
const MIN_AUC = 0.8;

if (mode === 'pool') {
  const hidden = option('hidden', 8);
  // 同じ審査役に同じ既知の投稿を何度も見せないよう、回ごとにずらす
  const offset = option('offset', 0);
  const candidates = read(candidatesPath).items;
  const posts: any[] = read(join(buzzDir, 'corpus.json')).posts;
  const coded = new Map<string, any>(read(join(buzzDir, 'coded.json')).map((row: any) => [row.id, row]));
  const base: any[] = Object.values<any[]>(read(join(buzzDir, 'denominator.json')).samples).flat();
  const buzz = posts
    .filter(post => !post.media.length && ['small_episode', 'witness', 'one_liner'].includes(coded.get(post.id)?.structure) && ['laugh', 'relate', 'anger'].includes(coded.get(post.id)?.emotion))
      .slice(offset, offset + hidden).map(post => ({ kind: 'hidden_buzz', text: clean(post.text) }));
  const quiet = base.filter(post => post.text.length > 60 && !/^@|^RT|#/.test(post.text))
      .slice(offset, offset + hidden).map(post => ({ kind: 'hidden_base', text: clean(post.text) }));
  const pool = [...candidates.map((item: any) => ({ kind: 'candidate', n: item.n, text: String(item.text).replace(/\n/g, ' ') })), ...buzz, ...quiet]
    .map(item => ({ ...item, code: `R${createHash('sha1').update(`${candidatesPath}:${item.text}`).digest('hex').slice(0, 6)}` }))
    .sort((a, b) => a.code.localeCompare(b.code));
  writeFileSync(join(dir, 'rank_key.json'), JSON.stringify(pool.map(({ code, kind, n }: any) => ({ code, kind, n })), null, 1));
  writeFileSync(join(dir, 'rank_blind.json'), JSON.stringify(pool.map(({ code, text }) => ({ code, text })), null, 1));
  console.log(JSON.stringify({ candidates: candidates.length, hiddenBuzz: buzz.length, hiddenBase: quiet.length, blind: join(dir, 'rank_blind.json') }));
} else if (mode === 'score') {
  const key = new Map<string, any>(read(join(dir, 'rank_key.json')).map((row: any) => [row.code, row]));
  const predictions: any[] = read(join(dir, 'rank_pred.json'));
  const kind = (row: any) => key.get(row.code)?.kind;
  const positives = predictions.filter(row => kind(row) === 'hidden_buzz');
  const negatives = predictions.filter(row => kind(row) === 'hidden_base');
  let wins = 0;
  for (const positive of positives) for (const negative of negatives) wins += positive.p > negative.p ? 1 : positive.p === negative.p ? 0.5 : 0;
  const auc = positives.length && negatives.length ? wins / (positives.length * negatives.length) : null;
  const candidates = read(candidatesPath).items;
  const buzzMedian = [...positives.map(row => row.p)].sort((a, b) => a - b)[Math.floor(positives.length / 2)] ?? null;
  const ranked = predictions.filter(row => kind(row) === 'candidate')
    .map(row => ({ ...row, n: key.get(row.code).n, text: candidates.find((item: any) => item.n === key.get(row.code).n)?.text }))
    .sort((a, b) => b.p - a.p);
  const result = { auc, trusted: auc !== null && auc >= MIN_AUC, hiddenBuzzMedianP: buzzMedian, aboveBuzzMedian: ranked.filter(row => buzzMedian !== null && row.p >= buzzMedian).length, ranked };
  writeFileSync(join(dir, 'rank_result.json'), JSON.stringify(result, null, 1));
  console.log(`AUC on hidden known posts: ${auc?.toFixed(3)} (${result.trusted ? 'trusted' : 'NOT trusted'}) / hidden buzz median p=${buzzMedian}`);
  for (const row of ranked) console.log(`${String(row.p).padStart(3)}  #${row.n}  ${row.why ?? ''}  |  ${String(row.text).replace(/\n/g, ' ').slice(0, 60)}`);
} else {
  console.error(`unknown mode: ${mode}`);
  process.exit(1);
}
