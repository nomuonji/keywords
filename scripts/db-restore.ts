import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = process.argv[2];
const target = process.argv[3] ?? process.env.KEYWORDS_DB_PATH ?? './data/keywords.sqlite';
if (!source) throw new Error('Usage: npx tsx scripts/db-restore.ts <backup.sqlite> [target.sqlite]');
const from = resolve(source);
const to = process.argv[3] ? resolve(target) : resolve(fileURLToPath(new URL('../', import.meta.url)), target);
if (!existsSync(from)) throw new Error(`Backup not found: ${from}`);
if (from === to) throw new Error('Backup and target paths must differ');
const sourceDb = new Database(from, { readonly: true, fileMustExist: true });
try {
  const check = sourceDb.pragma('quick_check', { simple: true });
  if (check !== 'ok') throw new Error(`Backup quick_check failed: ${String(check)}`);
} finally { sourceDb.close(); }
mkdirSync(dirname(to), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
if (existsSync(to)) copyFileSync(to, `${to}.pre-restore-${stamp}`);
const temp = `${to}.restore-${process.pid}.tmp`;
try {
  copyFileSync(from, temp);
  const copied = new Database(temp, { readonly: true, fileMustExist: true });
  try { const check = copied.pragma('quick_check', { simple: true }); if (check !== 'ok') throw new Error(`Copied database quick_check failed: ${String(check)}`); } finally { copied.close(); }
  renameSync(temp, to);
  console.log(JSON.stringify({ restored: true, source: from, target: to }, null, 2));
} catch (error) {
  if (existsSync(temp)) rmSync(temp, { force: true });
  throw error;
}
