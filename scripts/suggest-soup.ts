// Google サジェストを あ〜ん で総当たりし、実際に打たれている語の枝を集める（帰納的な語の発掘）
//
// 使い方:
//   cd D:\youph\keywords
//   node --import tsx/esm scripts/suggest-soup.ts <out.json> "シード1" "シード2" ...
//
// 出力: { [seed]: string[] } — シード／シード＋空白／シード＋空白＋各かな のサジェストの和集合
//   - サジェストに出る＝実際に打たれている（存在の証拠）。量は分からないので、量は kw-volumes.ts で測る
//   - 長い語は Google Ads が値を返さないことが多い。Ads が null でもサジェストに出ていれば存在はしている
//   - 1リクエストごとに 120ms あける（1シードあたり約48リクエスト）
import { writeFileSync } from 'node:fs';

const [out, ...seeds] = process.argv.slice(2);
if (!out || !seeds.length) {
  console.error('usage: suggest-soup.ts <out.json> <seed> [seed...]');
  process.exit(1);
}

const KANA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわ'.split('');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const result: Record<string, string[]> = {};
for (const seed of seeds) {
  const found = new Set<string>();
  for (const suffix of ['', ' ', ...KANA.map(kana => ` ${kana}`)]) {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=ja&gl=jp&q=${encodeURIComponent(seed + suffix)}`;
    try {
      const body = await (await fetch(url)).json() as [string, string[]];
      for (const suggestion of body[1] ?? []) found.add(suggestion);
    } catch {
      console.error(`fail ${seed}${suffix}`);
    }
    await sleep(120);
  }
  result[seed] = [...found];
  console.error(`${seed} ${found.size}`);
}
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ out, seeds: Object.fromEntries(Object.entries(result).map(([seed, list]) => [seed, list.length])) }));
