// 探索法の採点エンジン（tsk-v25 / I11 の実装）
//
// BREAKING: scripts/serp-score.ts は Brave 直叩きで、I1（実Google以外で競合を確定しない）に違反する。
// この採点エンジンは SerpRow[] を受け取り、ネットワークに触らない。SERP の取得は呼び出し側が行う
// （scripts/serp-reserp.ts が実Google、scripts/serp-score.ts は legacy）。
//
// I11 の3細則:
//   1. google.* のログインページ / maps エントリ / タイトル空 は「結果ではない」ので除外し、除外数を返す
//   2. 知恵袋・Quora は投稿が2年以上前なら弱い枠。新しいものは数えない
//   3. YouTube は個人の体験談のみ弱い枠。専門チャンネルの解説は数えない

export type SerpRow = {
  position: number;
  domain: string;
  title?: string;
  url?: string;
  /** 一覧に表示された相対日付（"7 年前", "3 年前" など）。無ければ空 */
  date?: string;
};

export type ScoreOptions = {
  /**
   * タイトル不一致を弱い枠に数えるか（既定 false）。
   * 既定で数えない理由: 「タイトルにクエリ語が無い」は「答えていない」証拠にならない。
   * 転職 後悔 の1位（じょぶる Japan）はタイトルに語が無いが、転職サービスの一等地ページで、
   * 数えると 7 が 8 に膨らんだ。過大評価より過小評価を選ぶ（I2 と同じ方向）。
   */
  countTitleMismatch?: boolean;
};

export type ScoreResult = {
  weakScore: number;
  counted: { position: number; domain: string; reason: string }[];
  big: { position: number; domain: string }[];
  excluded: { position: number; domain: string; reason: string }[];
  noiseExcluded: number;
};

const COMMUNITY = /chiebukuro|quora|girlschannel|mikle|bennavi|hasunoha|komachi|発言小町/i;
const BLOG = /note\.com|ameblo|hatena|hatenablog|blog\.|\.blogspot|livedoor\.jp|seesaa|fc2/i;
const VIDEO = /youtube|youtu\.be|nicovideo/i;
/** 個人の体験談を示す語。これが無い動画は「専門チャンネルの解説」とみなす。
 *  「後悔」「失敗」だけでは判定しない（プロの解説動画のタイトルにも入るため）。一人称か体験を要求する。 */
const PERSONAL_VIDEO = /体験|私|僕|俺|ぼく|わたし|vlog|日記/i;
const NOISE_HOST = /^(www\.)?(google|maps\.google)\./i;
const NOISE_TITLE = /^(ログイン|すべて|画像|)?$/;

/** 相対日付から年齢を読む。"7 年前" → 7、"3年前" → 3。読めなければ null */
export function ageYears(date?: string): number | null {
  if (!date) return null;
  const m = /(\d+)\s*年\s*前/.exec(date);
  if (m) return Number(m[1]);
  const months = /(\d+)\s*[ヶか]?月\s*前/.exec(date);
  if (months) return Number(months[1]) / 12;
  return null;
}

function normalizeTitle(title?: string): string {
  return String(title ?? '').replace(/\s+/g, ' ').trim();
}

export function scoreWeakSlots(rows: SerpRow[], query = '', opts: ScoreOptions = {}): ScoreResult {
  const countTitleMismatch = opts.countTitleMismatch === true;
  const tokens = query.split(/\s+/).filter(Boolean);
  const counted: ScoreResult['counted'] = [];
  const big: ScoreResult['big'] = [];
  const excluded: ScoreResult['excluded'] = [];

  for (const row of rows) {
    const title = normalizeTitle(row.title);
    const domain = row.domain || '';

    // 細則1: 結果ではないものを除外
    if (NOISE_HOST.test(domain)) {
      excluded.push({ position: row.position, domain, reason: 'noise:host' });
      continue;
    }
    if (NOISE_TITLE.test(title)) {
      excluded.push({ position: row.position, domain, reason: 'noise:title' });
      continue;
    }

    // 細則2: コミュニティは2年以上前だけ弱い枠
    if (COMMUNITY.test(domain)) {
      const age = ageYears(row.date);
      if (age !== null && age >= 2) {
        counted.push({ position: row.position, domain, reason: 'community:old' });
      } else if (age === null) {
        // 日付が取れない場合は弱い枠に数えない（数え落としより数え過ぎを避ける）
        big.push({ position: row.position, domain });
      } else {
        big.push({ position: row.position, domain });
      }
      continue;
    }

    // 細則3: 動画は個人の体験談だけ
    if (VIDEO.test(domain)) {
      if (PERSONAL_VIDEO.test(title)) {
        counted.push({ position: row.position, domain, reason: 'video:personal' });
      } else {
        big.push({ position: row.position, domain });
      }
      continue;
    }

    if (BLOG.test(domain)) {
      counted.push({ position: row.position, domain, reason: 'blog' });
      continue;
    }

    // タイトルがクエリの語を1つも含まない＝その問いに答えていない
    if (countTitleMismatch && tokens.length && !tokens.some((t) => title.includes(t))) {
      counted.push({ position: row.position, domain, reason: 'title-mismatch' });
      continue;
    }

    big.push({ position: row.position, domain });
  }

  return {
    weakScore: Math.min(10, counted.length),
    counted,
    big,
    excluded,
    noiseExcluded: excluded.length
  };
}
