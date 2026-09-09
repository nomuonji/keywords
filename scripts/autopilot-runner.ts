import { spawn } from 'node:child_process';
import { autopilotCommands } from '@keywords/commands/autopilot';
import { executorCommands } from '@keywords/commands/executor';
import { operationCommands } from '@keywords/commands/operation';

const command = process.env.KEYWORDS_AGENT_COMMAND?.trim();
if (!command) throw new Error('KEYWORDS_AGENT_COMMAND is required. Configure a persistent agent CLI (for example Codex) before starting npm run autopilot.');
let argTemplate: string[] = [];
try { const parsed = JSON.parse(process.env.KEYWORDS_AGENT_ARGS_JSON ?? '[]'); if (!Array.isArray(parsed) || parsed.some(x => typeof x !== 'string')) throw new Error(); argTemplate = parsed; }
catch { throw new Error('KEYWORDS_AGENT_ARGS_JSON must be a JSON array of strings'); }

const executorId = process.env.KEYWORDS_AGENT_ID?.trim() || 'mcp';
const leaseSeconds = Math.max(120, Math.min(Number(process.env.KEYWORDS_EXECUTOR_LEASE_SECONDS ?? 900), 3600));
const pollSeconds = Math.max(10, Number(process.env.KEYWORDS_AUTOPILOT_RUNNER_POLL_SECONDS ?? 30));
const cwd = process.env.KEYWORDS_AGENT_CWD?.trim() || process.cwd();
const agentCtx = { actor: 'agent' as const, actorId: executorId };
const systemCtx = { actor: 'system' as const, actorId: 'autopilot' };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function promptFor(claim: any) {
  return `You are the persistent SEO execution agent for Keywords.

Operation ID: ${claim.operationId}
Project ID: ${claim.projectId}
Work session ID: ${claim.workSessionId ?? 'none'}
Objective: ${claim.objective}

Use the Keywords MCP/CLI already configured in this environment. First read work_context for project ${claim.projectId} and explicitly pass sessionId ${claim.workSessionId ?? ''} so the shared action budget is attached to this process. Then read operation_context/operator_context as needed.

Operate autonomously inside the objective and budget. For any content plan, read blog_contract, collect real sources, create a page plan, and call blog_prepare with the autonomy packet: Source Packet source IDs, a claim-level Fact Ledger, evidence_score, commodity_risk, at least two concrete information_gain items, and all six publication_gate component scores. Do not ask a human to approve ordinary content. Leave the page proposed and checkpoint with nextAction "await_autopilot_gate"; the deterministic control plane will approve, revise, or reject it. On a later claim, if an authorized Blog handoff is ready, carry it through the existing Blog-side agent workflow and return receipts/outcomes.

Never invent first-hand experience, measurements, quotes, reviews, or current facts. Never delete pages, move URLs, change DNS, rotate credentials, or activate policy rules. When the objective is complete, call operation_complete. If an external dependency truly blocks progress, checkpoint the operation as blocked with a concise reason.`;
}

async function runAgent(claim: any, generation: number) {
  const prompt = promptFor(claim);
  const hasPromptSlot = argTemplate.some(arg => arg.includes('{prompt}'));
  const args = argTemplate.map(arg => arg.replaceAll('{prompt}', prompt));
  const child = spawn(command!, args, { cwd, env: { ...process.env, KEYWORDS_AGENT_ID: executorId, KEYWORDS_OPERATION_ID: claim.operationId, KEYWORDS_PROJECT_ID: claim.projectId, KEYWORDS_WORK_SESSION_ID: claim.workSessionId ?? '' }, shell: false, stdio: ['pipe','inherit','inherit'] });
  if (!hasPromptSlot) { child.stdin.write(prompt); child.stdin.end(); }
  const heartbeat = setInterval(() => void operationCommands.executorHeartbeat(agentCtx, { executorId, generation, leaseSeconds }).catch(error => console.error('Autopilot heartbeat failed:', error)), Math.min(60_000, leaseSeconds * 500));
  heartbeat.unref();
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }).finally(() => clearInterval(heartbeat));
  if (code !== 0) {
    try { await operationCommands.checkpoint({ ...agentCtx, projectId: claim.projectId, workSessionId: claim.workSessionId ?? undefined }, { operationId: claim.operationId, projectId: claim.projectId, state: 'blocked', summary: `External agent process exited with code ${code ?? 'unknown'}.`, nextAction: 'Inspect agent stderr and retry after fixing the executor.' }); } catch (error) { console.error('Failed to checkpoint agent exit:', error); }
  }
  await operationCommands.executorRelease(agentCtx, { executorId, generation, operationId: claim.operationId, projectId: claim.projectId }).catch(error => console.error('Executor release failed:', error));
  await autopilotCommands.tick(systemCtx, claim.projectId);
}

let registration = await operationCommands.executorRegister(agentCtx, { executorId, capabilities: ['operation','research','planning','blog'], leaseSeconds });
console.log(`Keywords autopilot runner online as ${executorId} generation ${registration.generation}`);

for (;;) {
  try {
    const projectIds = await autopilotCommands.enabledProjects();
    for (const projectId of projectIds) await autopilotCommands.tick(systemCtx, projectId);
    await operationCommands.executorHeartbeat(agentCtx, { executorId, generation: registration.generation, leaseSeconds });
    const claim = await executorCommands.claimNext(agentCtx, { executorId, generation: registration.generation, leaseSeconds });
    if (claim.claimed) await runAgent(claim, registration.generation);
  } catch (error) {
    console.error('Autopilot runner cycle failed:', error);
    try { registration = await operationCommands.executorRegister(agentCtx, { executorId, capabilities: ['operation','research','planning','blog'], leaseSeconds }); } catch (registrationError) { console.error('Executor re-registration failed:', registrationError); }
  }
  await sleep(pollSeconds * 1000);
}
