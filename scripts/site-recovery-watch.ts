import { runSeoRecoveryCircuitBreaker } from '../packages/commands/src/seo-recovery-watch.js';

const result = await runSeoRecoveryCircuitBreaker();
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
