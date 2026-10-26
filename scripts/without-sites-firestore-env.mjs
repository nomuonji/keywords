// Runs a command with the Sites Firestore cutover variables removed.
// Build-time smoke tests use in-memory Firestore doubles keyed to the legacy
// project; they must not inherit the deployment's live routing settings
// (SITES_FIRESTORE_TARGET=sites on Vercel). Cross-platform replacement for `env -u`.
import { spawnSync } from 'node:child_process';

const env = { ...process.env };
for (const name of ['SITES_FIRESTORE_TARGET', 'SITES_FIREBASE_SERVICE_ACCOUNT_JSON', 'SITES_FIREBASE_SERVICE_ACCOUNT_BASE64', 'SITES_FIREBASE_PROJECT_ID']) delete env[name];
const [command, ...args] = process.argv.slice(2);
if (!command) { console.error('usage: node scripts/without-sites-firestore-env.mjs <command> [...args]'); process.exit(2); }
const result = spawnSync(command, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
