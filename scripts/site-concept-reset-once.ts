/**
 * One-time owner-authorized deletion of exactly 17 legacy siteStructures.
 * Only siteStructures are touched: treasury, ideaMemory and Site Registry stay intact.
 * All checks run before one atomic Firestore commit.
 */
import { randomUUID } from 'node:crypto';
import { firestore, firestoreDocumentName, field, value } from '../packages/db/src/firestore.js';

const keepId = 'toy-buy-or-rent-guide';
const expectedLegacy = new Map<string, { title: string; revision: number }>([
  ["expense-management-saas-db", { title: "中小企業向け経費精算システム比較DB", revision: 2 }],
  ["form-builder-saas-db", { title: "フォーム作成ツール比較DB", revision: 2 }],
  ["b2b-outsourcing-db", { title: "電話代行・オンライン秘書比較DB", revision: 2 }],
  ["reservation-saas-db", { title: "業種別予約システム比較DB", revision: 2 }],
  ["electronic-contract-saas-db", { title: "電子契約・契約管理SaaS比較DB", revision: 2 }],
  ["english-coaching-db", { title: "英語コーチング比較DB", revision: 2 }],
  ["video-editing-school-db", { title: "動画編集スクール比較DB", revision: 2 }],
  ["startup-company-formation-db", { title: "会社設立・法人化サービス比較DB", revision: 2 }],
  ["attendance-saas-industry-db", { title: "業種別・中小企業向け勤怠管理システム比較DB", revision: 2 }],
  ["real-estate-appraisal-db", { title: "マンション・不動産一括査定比較DB", revision: 2 }],
  ["resignation-agency-db", { title: "退職代行・退職手続き比較DB", revision: 2 }],
  ["damaged-car-buyback-db", { title: "廃車・事故車・不動車買取比較DB", revision: 2 }],
  ["corporate-communications-db", { title: "法人通信・クラウド電話比較DB", revision: 2 }],
  ["young-career-agent-db", { title: "20代の仕事・お金・暮らしを整える情報DB", revision: 5 }],
  ["niche-parts-compat-guide", { title: "これ、どれ買えばいい？｜ニッチ部品・消耗品の互換ガイド", revision: 2 }],
  ["public-housing-moveout-db", { title: "公営住宅の退去費用・原状回復ルールDB", revision: 2 }],
  ["site-concept-starter", { title: "サイト構想テンプレート", revision: 2 }],
]);
const listing = await firestore('/siteStructures?pageSize=100');
if (listing.nextPageToken) throw new Error('Unexpected pagination; refusing partial reset');
const documents: any[] = listing.documents ?? [];
const allIds = documents.map(document => String(document.name).split('/').pop() ?? '');
const expectedAll = new Set([...expectedLegacy.keys(), keepId]);
if (documents.length !== expectedAll.size || new Set(allIds).size !== expectedAll.size ||
  allIds.some(id => !expectedAll.has(id))) {
  throw new Error('Unexpected site concept collection contents; refusing reset');
}
const keepDoc = documents.find(doc => doc.name.endsWith('/' + keepId));
if (!keepDoc || value(keepDoc.fields?.title ?? {}) !== 'おもちゃの買いどき｜知育玩具を買う・借りる判断サイト')
  throw new Error('New concept missing/mismatched; refusing reset');

const deletes = [];
for (const doc of documents) {
  const id = String(doc.name).split('/').pop()!;
  if (id === keepId) continue;
  const expected = expectedLegacy.get(id);
  if (!expected || value(doc.fields?.title ?? {}) !== expected.title ||
    value(doc.fields?.revision ?? {}) !== expected.revision || !doc.updateTime)
    throw new Error('Legacy concept was edited or missing: ' + id);
  deletes.push({ delete: firestoreDocumentName('siteStructures/' + id), currentDocument: { updateTime: doc.updateTime } });
}
if (deletes.length !== 17) throw new Error('Expected exactly 17 legacy concepts');
if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error('Firebase secret is unavailable');

const runId = randomUUID();
await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes: [
  ...deletes,
  { update: {
    name: firestoreDocumentName('runs/' + runId),
    fields: Object.fromEntries(Object.entries({
      id: runId, command: 'site_structure_one_time_reset',
      actor: 'owner_explicit_delete', createdAt: new Date().toISOString(),
      deletedCount: 17, kept: keepId, deletedIds: [...expectedLegacy.keys()]
    }).map(([key, item]) => [key, field(item)]))
  }, currentDocument: { exists: false } }
] }) });

const verification = await firestore('/siteStructures?pageSize=100');
const remaining = (verification.documents ?? []).map((doc: any) => String(doc.name).split('/').pop());
if (verification.nextPageToken || remaining.length !== 1 || remaining[0] !== keepId)
  throw new Error('Deletion committed but verification found unexpected records: ' + remaining.join(','));
console.log('Verified: deleted exactly 17 old site concepts; kept ' + keepId + '; audit ' + runId);
