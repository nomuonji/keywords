import { spawn } from 'node:child_process';
import { autopilotCommands } from '@keywords/commands/autopilot';
import { executorCommands } from '@keywords/commands/executor';
import { operationCommands } from '@keywords/commands/operation';

const command = process.env.KEYWORDS_AGENT_COMMAND?.trim();
if (!command) throw new Error('KEYWORDS_AGENT_COMMAND is required. Configure a persistent agent CLI before starting npm run autopilot.');
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

Use the Keywords MCP already configured in this environment. First call work_context for project ${claim.projectId} with sessionId ${claim.workSessionId ?? ''} so this process is attached to the shared action budget. Use operator_context and Blog tools as needed.

For a content plan: read blog_contract, collect real sources, create the page plan, then call blog_prepare with autonomy evidence containing Source Packet source IDs, claim-level Fact Ledger, evidence_score, commodity_risk, at least two concrete information_gain items, and all six publication_gate component scores. Do not ask a human to approve ordinary content. Leave the page proposed; the deterministic control plane will approve, revise, or reject it after this process exits.

If the objective references an authorized handoff, call blog_get with that handoff ID, verify publication_authorized=true, carry the payload through the existing Blog-side agent workflow, and submit Blog receipts/outcomes back to Keywords.

Never invent experience, measurements, quotes, reviews, or current facts. Never delete pages, move URLs, change DNS, rotate credentials, or activate policy rules. If a real external dependency blocks progress, use work_checkpoint with state=blocked and a concise next action. Otherwise finish your assigned work cleanly; the runner will close the parent Operation.`;
}

async function closeFromWorkState(claim: any, opCtx: any) {
  const current: any = await operationCommands.context(opCtx, { operationId: claim.operationId });
  const project = current.projects?.find((item: any) => item.projectId === claim.projectId);
  const workStatus = project?.work?.status;
  if (workStatus === 'blocked' || workStatus === 'awaiting_review') {
    // A blocked/awaiting-review session rejects further session-scoped writes.
    // The parent operation still needs its state synchronized, so checkpoint
    // it through the executor context without the paused session id.
    await operationCommands.checkpoint({ ...opCtx, workSessionId: undefined }, {
      operationId: claim.operationId,
      projectId: claim.projectId,
      state: workStatus,
      summary: project.work.summary || `Execution agent left work in ${workStatus}.`,
      nextAction: project.work.nextAction || 'Inspect the persisted blocker before retrying.'
    });
    return;
  }
  // The agent may have completed its work session itself. Completion of the
  // parent operation is still a control-plane action and must not inherit a
  // completed session id, because completed sessions intentionally reject writes.
  await operationCommands.complete({ ...opCtx, workSessionId: undefined }, { operationId: claim.operationId, summary: 'Persistent execution agent finished the assigned autonomous operation.' });
}

async function runAgent(claim: any, generation: number) {
  const prompt = promptFor(claim), hasPromptSlot = argTemplate.some(arg => arg.includes('{prompt}')), args = argTemplate.map(arg => arg.replaceAll('{prompt}', prompt));
  const child = spawn(command!, args, { cwd, env: { ...process.env, KEYWORDS_AGENT_ID: executorId, KEYWORDS_OPERATION_ID: claim.operationId, KEYWORDS_PROJECT_ID: claim.projectId, KEYWORDS_WORK_SESSION_ID: claim.workSessionId ?? '' }, shell: false, stdio: ['pipe','inherit','inherit'] });
  if (!hasPromptSlot) { child.stdin.write(prompt); child.stdin.end(); }
  const heartbeat = setInterval(() => void operationCommands.executorHeartbeat(agentCtx, { executorId, generation, leaseSeconds }).catch(error => console.error('Autopilot heartbeat failed:', error)), Math.min(60_000, leaseSeconds * 500));
  heartbeat.unref();
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }).finally(() => clearInterval(heartbeat));
  const opCtx = { ...agentCtx, projectId: claim.projectId, workSessionId: claim.workSessionId ?? undefined };
  if (code === 0) {
    try { await closeFromWorkState(claim, opCtx); }
    catch (error) { console.error('Failed to reconcile completed agent work:', error); }
  } else {
    try { await operationCommands.checkpoint(opCtx, { operationId: claim.operationId, projectId: claim.projectId, state: 'blocked', summary: `External agent process exited with code ${code ?? 'unknown'}.`, nextAction: 'Inspect agent stderr and retry after fixing the executor.' }); }
    catch (error) { console.error('Failed to checkpoint agent exit:', error); }
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
    try { registration = await operationCommands.executorRegister(agentCtx, { executorId, capabilities: ['operation','research','planning','blog'], leaseSeconds }); }
    catch (registrationError) { console.error('Executor re-registration failed:', registrationError); }
  }
  await sleep(pollSeconds * 1000);
}
