// Runs a command in single-Firestore-project mode, for build-time tests.
// The smoke tests use in-memory Firestore doubles for one project; they must
// not inherit the deployment's real Sites project credentials. Production
// never sets FIRESTORE_SINGLE_PROJECT (docs/firestore-project-split.md).
import { spawnSync } from 'node:child_process';

const env = { ...process.env, FIRESTORE_SINGLE_PROJECT: '1' };
for (const name of ['SITES_FIREBASE_SERVICE_ACCOUNT_JSON', 'SITES_FIREBASE_SERVICE_ACCOUNT_BASE64', 'SITES_FIREBASE_PROJECT_ID']) delete env[name];
const [command, ...args] = process.argv.slice(2);
if (!command) { console.error('usage: node scripts/with-single-firestore-project.mjs <command> [...args]'); process.exit(2); }
const result = spawnSync(command, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
