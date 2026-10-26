import { appendFileSync, writeFileSync } from 'node:fs';
import { runSitesFirestoreMigration, type MigrationMode, type MigrationReport } from '../packages/commands/src/sites-firestore-migration.js';

// Moves Sites Operator data from the legacy shared Firebase project to the
// dedicated Sites project. Runbook: docs/firestore-project-split.md.
// Credentials: FIREBASE_SERVICE_ACCOUNT_JSON (legacy/source) and
// SITES_FIREBASE_SERVICE_ACCOUNT_JSON (Sites/target).

const modes = new Set<MigrationMode>(['inventory', 'copy', 'delta', 'verify']);
const mode = (process.env.MIGRATION_MODE ?? process.argv[2] ?? 'inventory') as MigrationMode;
if (!modes.has(mode)) { console.error(`Unknown mode "${mode}" (inventory | copy | delta | verify)`); process.exit(2); }
const number = (name: string, fallback: number) => { const value = Number(process.env[name] ?? ''); return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback; };
const flag = (name: string) => /^(1|true|yes)$/i.test(process.env[name] ?? '');

function summary(report: MigrationReport) {
  const lines = [
    `## Sites Firestore migration: ${report.mode} — ${report.outcome}`,
    '',
    report.message,
    '',
    `- ${report.sourceProjectId} → ${report.targetProjectId}`,
    `- source reads ${report.sourceReads}, target reads ${report.targetReads}, target writes ${report.targetWrites}`,
  ];
  if (report.units?.length) {
    lines.push('', '| collection | legacy | sites | status |', '|---|---:|---:|---|');
    for (const unit of report.units) lines.push(`| ${unit.path} | ${unit.source ?? ''} | ${unit.target ?? ''} | ${unit.status ?? ''} |`);
  }
  for (const [title, items] of [['Conflicts / differences', report.conflicts], ['Skipped', report.skipped], ['Warnings', report.warnings]] as const) {
    if (items.length) lines.push('', `### ${title}`, ...items.slice(0, 200).map(item => `- ${item}`));
  }
  return lines.join('\n');
}

const report = await runSitesFirestoreMigration({
  mode,
  maxSourceReads: number('MAX_SOURCE_READS', 30_000),
  maxTargetWrites: number('MAX_TARGET_WRITES', 18_000),
  restart: flag('MIGRATION_RESTART'),
  deep: flag('MIGRATION_DEEP'),
  log: line => console.log(line),
});
const text = summary(report);
console.log(text);
writeFileSync('sites-firestore-migration-report.json', JSON.stringify(report, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
if (report.outcome === 'refused') process.exit(1);
