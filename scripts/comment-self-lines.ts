// comment-corpus.ts の出力から、書き手が自分の経験を語ったコメントだけを抜き出す
//
// 使い方:
//   cd D:\youph\keywords
//   node --import tsx/esm scripts/comment-self-lines.ts <corpus.jsonl> [--min-empathy 0] [--limit 200]
//
// 出力: 共感の多い順に「カテゴリ | 共感 | 本文（150字）| 記事URL」
//   - 「自分」だけでは拾わない（批判文の主語にも使われ、ノイズが多い）。体験の語り（私も・うちの・夫が・〜年前に・
//     勤めていた・入院した・〜歳です 等）に限る
//   - ここから生活の具体物と出来事を読み、本人の言葉のまま suggest-soup.ts の種にする
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const input = args.find(arg => !arg.startsWith('--'));
if (!input) {
  console.error('usage: comment-self-lines.ts <corpus.jsonl> [--min-empathy N] [--limit N]');
  process.exit(1);
}
const option = (name: string, fallback: number) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? Number(args[index + 1]) : fallback;
};

const EXPERIENCE = /(私も|私は|私が|私の(家|母|父|夫|妻|子|職場|会社|地元|住む)|うちの|我が家|主人が|主人は|夫が|旦那が|妻が|嫁が|義母|義父|母が|父が|祖母|祖父|息子が|娘が|孫が|年前に|若い頃|学生の頃|子供の頃|勤めて|働いて(い|た)|入院(し|中)|通院|歳です|代です|歳の|元[^ 、。]{1,8}です|住んでいます|住んでいた|経験があります|経験しました)/;

const rows = readFileSync(input, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  .filter(row => EXPERIENCE.test(row.text) && row.empathy >= option('min-empathy', 0))
  .sort((a, b) => b.empathy - a.empathy)
  .slice(0, option('limit', 200));

console.error(`experience comments: ${rows.length}`);
for (const row of rows) {
  console.log([row.category, row.empathy, String(row.text).replace(/\s+/g, ' ').slice(0, 150), `https://news.yahoo.co.jp/articles/${row.articleId}/comments`].join(' | '));
}
