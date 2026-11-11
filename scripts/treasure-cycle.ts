// 探索法の実行層（1サイクル = 候補 → 需要 → 実Google → 採点 → 判定 → 記録）
//
// 使い方:
//   node --env-file=.env --import tsx/esm scripts/treasure-cycle.ts "KW1" "KW2" ...
//   node --env-file=.env --import tsx/esm scripts/treasure-cycle.ts --domain account3 "占い 依存" "占い やめたい"
//
// 出力: 各語の 需要 / CPC / 弱い枠 / 判定（C2〜C4）と、docs/treasure-cycles/<日付>.json への記録
//   C1（本人が書ける）は台帳の domain で与える。C6（一次資料）は別途取得して記録する。
//
// 依存: @keywords/research の Google Ads、Reserp（実Google）、scripts/treasure-score.ts（I11 採点）
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { googleAdsKeywordHistoricalMetrics } from '@keywords/research';
import { scoreWeakSlots, type SerpRow } from './treasure-score.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvKey(): string {
  if (process.env.RESERP_API_KEY) return process.env.RESERP_API_KEY;
  try {
    const env = readFileSync(join(root, '.env'), 'utf8');
    const line = env.split(/\r?\n/).find((l) => l.startsWith('RESERP_API_KEY='));
    if (line) return line.slice('RESERP_API_KEY='.length).trim().replace(/^"|"$/g, '');
  } catch {}
  throw new Error('RESERP_API_KEY missing');
}

type SerpPayload = { results?: { url?: string; text?: string }[] };

function parseRows(payload: SerpPayload): SerpRow[] {
  const rows: SerpRow[] = [];
  for (const [i, item] of (payload.results ?? []).slice(0, 10).entries()) {
    const url = item.url ?? '';
    let domain = '';
    try {
      domain = new URL(url).hostname;
    } catch {
      domain = '';
    }
    const text = (item.text ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
    const title = text.find((x) => x !== domain && !x.startsWith('http') && x.length > 8) ?? text[1] ?? '';
    const date = text.find((x) => /年前|月前|日前/.test(x)) ?? '';
    rows.push({ position: i + 1, domain, title, url, date });
  }
  return rows;
}

async function serp(query: string): Promise<SerpRow[]> {
  const key = loadEnvKey();
  const gurl = `https://www.google.com/search?${new URLSearchParams({ q: query, gl: 'jp', hl: 'ja' })}`;
  const res = await fetch('https://api.reserp.ai/v2/serp/search', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url: gurl })
  });
  if (!res.ok) throw new Error(`reserp ${res.status}`);
  return parseRows((await res.json()) as SerpPayload);
}

type Judgement = {
  keyword: string;
  volume: number | null;
  cpcYen: number | null;
  competitionIndex: number | null;
  weakScore: number | null;
  noiseExcluded: number;
  pass: { C2: boolean; C3: boolean; C4: boolean };
  verdict: 'pass' | 'hold' | 'reject';
  reasons: string[];
};

async function main() {
  const argv = process.argv.slice(2);
  let domain = '';
  let dest = '';
  let destCpc: number | null = null;
  const queries: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--domain') domain = argv[++i];
    else if (argv[i] === '--dest') dest = argv[++i];
    else if (argv[i] === '--dest-cpc') destCpc = Number(argv[++i]);
    else queries.push(argv[i]);
  }
  if (!queries.length) {
    console.error('usage: treasure-cycle.ts [--domain <account>] "KW1" ["KW2" ...]');
    process.exit(1);
  }

  const demand = await googleAdsKeywordHistoricalMetrics({ keywords: queries });
  const byKeyword = new Map<string, any>();
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  for (const row of (demand as any).results ?? []) byKeyword.set(norm(String(row.text)), row);
  for (const row of (demand as any).results ?? []) byKeyword.set(String(row.text), row);

  const out: Judgement[] = [];
  for (const q of queries) {
    const d = byKeyword.get(q) ?? byKeyword.get(norm(q)) ?? null;
    const volume = typeof d?.avgMonthly === 'number' ? d.avgMonthly : null;
    const cpcYen = typeof d?.averageCpcMicros === 'number' ? Math.round(d.averageCpcMicros / 1_000_000) : null;
    const competitionIndex = typeof d?.competitionIndex === 'number' ? d.competitionIndex : null;

    let weakScore: number | null = null;
    let noiseExcluded = 0;
    try {
      const rows = await serp(q);
      const scored = scoreWeakSlots(rows, q);
      weakScore = scored.weakScore;
      noiseExcluded = scored.noiseExcluded;
    } catch (error) {
      console.error(`serp failed: ${q}: ${(error as Error).message}`);
    }

    const C2 = volume !== null && volume >= 10;
    const C3 = weakScore !== null && weakScore >= 6;
    // C4 は「入口語のCPC」ではなく「送客先のCPC」で測る（I12）。
    // 直API は averageCpcMicros を返さないので、値は MCP の keyword_screen_batch から受け取る。
    const effectiveCpc = destCpc !== null ? destCpc : cpcYen;
    const C4 = effectiveCpc !== null && effectiveCpc >= 100;
    const reasons: string[] = [];
    if (volume === null) reasons.push('C2: Ads null（Hold。0 ではない）');
    else if (!C2) reasons.push(`C2: ${volume}/月 < 10`);
    if (weakScore === null) reasons.push('C3: SERP取得失敗（棄却ではなく Hold）');
    else if (!C3) reasons.push(`C3: 弱い枠 ${weakScore}/10 < 6`);
    if (!C4) reasons.push(`C4: 送客先 ${dest || '(未指定)'} のCPC ${effectiveCpc === null ? 'null' : '¥' + effectiveCpc} < ¥100`);

    // SERP取得失敗は棄却と混ぜない。測れなかったものは Hold。
    const verdict: Judgement['verdict'] =
      weakScore === null ? 'hold' : C2 && C3 && C4 ? 'pass' : !C2 && weakScore >= 6 ? 'hold' : 'reject';
    out.push({ keyword: q, volume, cpcYen, competitionIndex, weakScore, noiseExcluded, pass: { C2, C3, C4 }, verdict, reasons });
    console.error(`${verdict.toUpperCase()} ${q} | vol=${volume} cpc=${cpcYen} weak=${weakScore} noise=${noiseExcluded}`);
  }

  const dir = join(root, 'docs/treasure-cycles');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const file = join(dir, `${stamp}${domain ? '-' + domain : ''}.json`);
  writeFileSync(file, JSON.stringify({ measuredAt: new Date().toISOString(), domain: domain || null, methodVersion: 'tsk-v25', judgements: out }, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
  console.error(`saved: ${file.replace(root + '\\', '').replace(root + '/', '')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
