// Yahoo!ニュースのコメント欄から、書き手が自分の生活を語った文を集める（コンシューマーモデルの帰納用コーパス）
//
// 使い方:
//   cd D:\youph\keywords
//   node --import tsx/esm scripts/comment-corpus.ts <out.jsonl> [--categories domestic,life,business] [--articles 8] [--pages 3]
//
// 出力: 1行1コメントの JSONL
//   { articleId, headline, category, page, text, empathy, insight, negative, postDate }
//   - ユーザー名・ID・プロフィールURLは保存しない。個人の履歴は追わない（記事単位のコーパスに限る）
//   - コメント本文は分析用。外へ出すときは125字以内の引用と記事URLだけにする
//
// 前提: コメントランキング（/ranking/comment/{category}）の上位記事から取る。1リクエストごとに1.5秒あける
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const out = args.find(arg => !arg.startsWith('--'));
if (!out) {
  console.error('usage: comment-corpus.ts <out.jsonl> [--categories a,b] [--articles N] [--pages N]');
  process.exit(1);
}
const option = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const categories = option('categories', 'domestic,life,business,entertainment,sports,world,it-science,local').split(',');
const articlesPerCategory = Number(option('articles', '8'));
const pagesPerArticle = Number(option('pages', '3'));

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function get(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  await sleep(1500);
  return response.text();
}

/** The comment objects sit in the preloaded state; pick only the fields that carry no identity. */
function parseComments(html: string) {
  const headline = html.match(/"commentArticle":\{[^}]*?"headline":"((?:[^"\\]|\\.)*)"/)?.[1] ?? '';
  const comments: Array<{ text: string; empathy: number; insight: number; negative: number; postDate: string }> = [];
  const pattern = /\{"text":"((?:[^"\\]|\\.)*)","name":"(?:[^"\\]|\\.)*","ppid":"[^"]*","commentId":"[^"]*","permalink":"[^"]*","empathyCount":(\d+),"insightCount":(\d+),"negativeCount":(\d+),"commentArticleId":"[^"]*","propertyId":"[^"]*","postDate":"([^"]*)"/g;
  for (const match of html.matchAll(pattern)) {
    comments.push({ text: JSON.parse(`"${match[1]}"`), empathy: Number(match[2]), insight: Number(match[3]), negative: Number(match[4]), postDate: match[5] });
  }
  return { headline: headline ? JSON.parse(`"${headline}"`) : '', comments };
}

const rows: string[] = [];
const seen = new Set<string>();
for (const category of categories) {
  let ranking: string;
  try {
    ranking = await get(`https://news.yahoo.co.jp/ranking/comment/${category}`);
  } catch (error) {
    console.error(`skip category ${category}: ${(error as Error).message}`);
    continue;
  }
  const ids = [...new Set([...ranking.matchAll(/news\.yahoo\.co\.jp\/articles\/([0-9a-f]{40})/g)].map(match => match[1]))]
    .filter(id => !seen.has(id)).slice(0, articlesPerCategory);
  for (const articleId of ids) {
    seen.add(articleId);
    for (let page = 1; page <= pagesPerArticle; page++) {
      try {
        const { headline, comments } = parseComments(await get(`https://news.yahoo.co.jp/articles/${articleId}/comments?page=${page}`));
        for (const comment of comments) rows.push(JSON.stringify({ articleId, headline, category, page, ...comment }));
        if (!comments.length) break;
      } catch (error) {
        console.error(`skip ${articleId} p${page}: ${(error as Error).message}`);
        break;
      }
    }
    console.error(`${category} ${articleId} total=${rows.length}`);
  }
}
writeFileSync(out, rows.join('\n') + '\n');
console.log(JSON.stringify({ out, comments: rows.length, articles: seen.size }));
