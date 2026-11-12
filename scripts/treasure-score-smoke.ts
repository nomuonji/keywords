// 採点エンジンの回帰テスト（ネットワーク不要）
//
// ここに固定するのは「公開済みの採点結果」。規則を変えたらこのテストが落ちるので、
// 方法論を黙って書き換えることができなくなる。数え方の本文は My Portal の探索拠点 treasure-keyword-note（method.body）にある。
//
// 使い方: npx tsx scripts/treasure-score-smoke.ts
import assert from 'node:assert/strict';
import { scoreWeakSlots, ageYears, type SerpRow } from './treasure-score.js';

let checks = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  assert.deepEqual(actual, expected, label);
  checks++;
}

// --- 細則の単体 ---
eq(ageYears('7 年前'), 7, 'ageYears: 7年前');
eq(ageYears('3年前'), 3, 'ageYears: 3年前');
eq(ageYears('6ヶ月前'), 0.5, 'ageYears: 6ヶ月前');
eq(ageYears(''), null, 'ageYears: 空');
eq(ageYears(undefined), null, 'ageYears: undefined');

// --- 転職 後悔（実測 弱い枠7 / 2026-11-11 / reserp）---
const tenshoku: SerpRow[] = [
  { position: 1, domain: 'be-win.co.jp', title: 'じょぶる Japan' },
  { position: 2, domain: 'www.bizreach.jp', title: '転職で後悔する理由とは？後悔しないためのポイントを解説' },
  { position: 3, domain: 'www.nikkei.com', title: '35歳からの初めての転職 後悔防ぐ7つの鉄則' },
  { position: 4, domain: 'detail.chiebukuro.yahoo.co.jp', title: 'Yahoo!知恵袋', date: '7 年前' },
  { position: 5, domain: 'detail.chiebukuro.yahoo.co.jp', title: '転職して後悔した方いますか？', date: '7 年前' },
  { position: 6, domain: 'detail.chiebukuro.yahoo.co.jp', title: '転職の猛者に問う', date: '7 年前' },
  { position: 7, domain: 'note.com', title: 'note · kei_carrer' },
  { position: 8, domain: 'jp.quora.com', title: '50 件以上の回答', date: '7 年前' },
  { position: 9, domain: 'jp.quora.com', title: 'あります。1社目から2社目', date: '7 年前' },
  { position: 10, domain: 'jp.quora.com', title: '私も近い経験があります', date: '7 年前' }
];
const r1 = scoreWeakSlots(tenshoku, '転職 後悔');
eq(r1.weakScore, 7, '転職 後悔 = 7');
eq(r1.counted.filter((c) => c.reason === 'community:old').length, 6, '転職 後悔: 知恵袋3+Quora3');
eq(r1.noiseExcluded, 0, '転職 後悔: ノイズ0');

// --- ペットロス（実測 弱い枠3 / CPC最安でも専門職が占める）---
const petloss: SerpRow[] = [
  { position: 1, domain: 'www.kurashinotomo.jp', title: 'Q.ペットロスはどれくらい続くものですか？' },
  { position: 2, domain: 'www.toyoda-clinic.jp', title: 'ペットロス 動物病院' },
  { position: 3, domain: 'detail.chiebukuro.yahoo.co.jp', title: 'Yahoo!知恵袋', date: '5 年前' },
  { position: 4, domain: 'detail.chiebukuro.yahoo.co.jp', title: 'ペットロスの立ち直り方', date: '4 年前' },
  { position: 5, domain: 'detail.chiebukuro.yahoo.co.jp', title: '初めてペットロスを経験した時', date: '3 年前' },
  { position: 6, domain: 'jamc.co.jp', title: '日本動物医療センター' },
  { position: 7, domain: 'petreien.or.jp', title: '全国ペット霊園協会' },
  { position: 8, domain: 'www.osohshiki.jp', title: 'ペットロスから立ち直るために' },
  { position: 9, domain: 'hibiya-pet.com', title: '日比谷花壇のペット葬' },
  { position: 10, domain: 'www.green-dog.com', title: 'GREEN DOG & CAT' }
];
eq(scoreWeakSlots(petloss, 'ペットロス').weakScore, 3, 'ペットロス = 3');

// --- 空き家 売却（実測 弱い枠0）---
const akiya: SerpRow[] = [
  { position: 1, domain: 'www.fundex.co.jp', title: '空き家を売却するには、まず' },
  { position: 2, domain: 'www.mlit.go.jp', title: '空き家 制度' },
  { position: 3, domain: 'www.mlit.go.jp', title: '空き家の主な売却方法' },
  { position: 4, domain: 'www.akiya-akichi.or.jp', title: 'そのまま売却（仲介）' },
  { position: 5, domain: 'philia-co.com', title: '不動産会社に直接買い取ってもらう' },
  { position: 6, domain: 'souzoku.asahi.com', title: '空き家 売却 相続' },
  { position: 7, domain: 'www.lvn.co.jp', title: '空き家を売りたい！3つの売却方法と費用・税金' },
  { position: 8, domain: 'www.housebokan.co.jp', title: '空き家買取の基礎知識' },
  { position: 9, domain: 'akiya-katsuyou.net', title: '空き家を売却したいときの相談先' },
  { position: 10, domain: 'akiya-kaitori.net', title: '相続した日本の実家に困る' }
];
eq(scoreWeakSlots(akiya, '空き家 売却').weakScore, 0, '空き家 売却 = 0');

// --- 細則1: ノイズは枠ではない（転職 失敗 その後 はノイズ1件で7→6になった）---
const withNoise: SerpRow[] = [
  { position: 1, domain: 'www.google.com.tw', title: 'ログイン' },
  { position: 2, domain: 'www.bizreach.jp', title: '初の転職は「失敗だった」' },
  { position: 3, domain: 'www.jac-recruitment.jp', title: '転職の失敗談5選' },
  { position: 4, domain: 'detail.chiebukuro.yahoo.co.jp', title: '転職失敗談を教えてください', date: '3 年前' },
  { position: 5, domain: 'detail.chiebukuro.yahoo.co.jp', title: 'したーって体験談', date: '3 年前' },
  { position: 6, domain: 'detail.chiebukuro.yahoo.co.jp', title: '2021年4月26日', date: '4 年前' },
  { position: 7, domain: 'high-five.careers', title: '転職失敗？入社後にミスマッチ' },
  { position: 8, domain: 'note.com', title: '転職に失敗した30代へ' },
  { position: 9, domain: 'jp.quora.com', title: '思い切って転職したのに', date: '6 年前' },
  { position: 10, domain: 'jp.quora.com', title: 'あります。1社目から2社目', date: '6 年前' }
];
const r4 = scoreWeakSlots(withNoise, '転職 失敗 その後');
eq(r4.noiseExcluded, 1, 'ノイズ1件を除外');
eq(r4.weakScore, 6, '転職 失敗 その後 = 6（ノイズを数えない）');

// --- 細則3: 動画は個人の体験談だけ ---
const videos: SerpRow[] = [
  { position: 1, domain: 'www.youtube.com', title: '【実体験】転職して後悔した話' },
  { position: 2, domain: 'www.youtube.com', title: '【転職失敗を防ぐには】プロが徹底解説' },
  { position: 3, domain: 'detail.chiebukuro.yahoo.co.jp', title: '後悔しています', date: '3 年前' }
];
const r5 = scoreWeakSlots(videos, '転職 後悔 理由');
eq(r5.counted.filter((c) => c.reason === 'video:personal').length, 1, '体験談動画だけ数える');
eq(r5.weakScore, 2, '動画2本のうち体験談1本＋知恵袋1本');

// --- 新しい Quora は数えない ---
const fresh: SerpRow[] = [
  { position: 1, domain: 'jp.quora.com', title: '転職 後悔 について', date: '3ヶ月前' },
  { position: 2, domain: 'www.nikkei.com', title: '転職 後悔 の鉄則' }
];
eq(scoreWeakSlots(fresh, '転職 後悔').weakScore, 0, '新しいQuoraは数えない');

console.log(`treasure score smoke ok (${checks} checks)`);
