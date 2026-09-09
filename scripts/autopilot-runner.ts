import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { executorCommands } from '@keywords/commands/executor';
import { operationCommands } from '@keywords/commands/operation';
import { headlessCommands } from '@keywords/commands/headless';

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
const systemCtx = { actor: 'system' as const, actorId: `autopilot-worker:${executorId}` };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let stopping = false;
let activeChild: ChildProcessWithoutNullStreams | null = null;

function promptFor(claim: any) {
  return `You are the persistent SEO execution agent for Keywords.
Operation ID: ${claim.operationId}
Project ID: ${claim.projectId}
Work session ID: ${claim.workSessionId ?? 'none'}
Objective: ${claim.objective}

Use the Keywords MCP already configured in this environment. First call work_context for project ${claim.projectId} with sessionId ${claim.workSessionId ?? ''} so this process is attached to the shared action budget. Read operation_context and blog_artifactContext before repeating work after an interruption.

For content production, a page plan is NOT completion. Read blog_contract, collect only the evidence needed, create or reuse the page plan, then call blog_prepare with Source Packet source IDs, claim-level Fact Ledger, evidence_score, commodity_risk, concrete information_gain and all publication-gate components. After the brief is persisted, write the actual article through blog_writeDraft. Then call blog_validateDraft. Fix only failed validator checks, write the revised file again, and validate again until it passes or the revision boundary stops you. Do not claim completion without a passed local artifact and site build.

If enough saved source evidence already exists, do not repeat discovery. Preserve the same page/article/operation IDs during resume. Never write article files outside the configured Blog root and never bypass the artifact commands with an untracked write.

If the objective references an authorized handoff, call blog_get with that handoff ID, verify publication_authorized=true, carry the payload through the existing Blog-side workflow, and submit idempotent Blog receipts/outcomes back to Keywords. Never claim publication without the receipt contract's HTTP/canonical evidence.

Never invent experience, measurements, quotes, reviews, current facts or source support. Never delete pages, move URLs, change DNS, rotate credentials or activate policy rules. If a real site-specific dependency blocks progress, use work_checkpoint with state=blocked and a concise next action. Executor/provider/runtime failures are handled by the runner and must not be converted into site blockers.`;
}

async function closeFromWorkState(claim: any, opCtx: any) {
  const current: any = await operationCommands.context(opCtx, { operationId: claim.operationId });
  const project = current.projects?.find((item: any) => item.projectId === claim.projectId);
  const workStatus = project?.work?.status;
  if (workStatus === 'blocked' || workStatus === 'awaiting_review') {
    await operationCommands.checkpoint({ ...opCtx, workSessionId: undefined }, {
      operationId: claim.operationId,
      projectId: claim.projectId,
      state: workStatus,
      summary: project.work.summary || `Execution agent left work in ${workStatus}.`,
      nextAction: project.work.nextAction || 'Inspect the persisted blocker before retrying.',
      blockerClass: workStatus === 'awaiting_review' ? 'human_decision_required' : (project.blockerClass ?? 'site_dependency_failed')
    });
    return;
  }
  const completion: any = await headlessCommands.completionStatus(claim.operationId);
  const child = completion.projects?.find((item: any) => item.projectId === claim.projectId);
  if (child?.required && !child.complete) {
    const blockerClass = child.artifact ? 'quality_revision_required' : 'artifact_missing';
    await headlessCommands.noteIncomplete(claim.operationId, claim.projectId, blockerClass, child.artifact
      ? `Article artifact is incomplete: validator=${child.artifact.validatorStatus}, build=${child.artifact.buildStatus}. Resume from the persisted artifact and failed checks.`
      : 'Content operation exited without a verified article artifact. Resume the same operation and write the article with blog_writeDraft.');
    return;
  }
  await operationCommands.complete({ ...opCtx, workSessionId: undefined }, { operationId: claim.operationId, summary: 'Persistent execution agent finished the assigned autonomous operation with required artifacts verified.' });
}

async function runAgent(claim: any, generation: number) {
  const prompt = promptFor(claim), hasPromptSlot = argTemplate.some(arg => arg.includes('{prompt}')), args = argTemplate.map(arg => arg.replaceAll('{prompt}', prompt));
  let stderr = '';
  let spawnError: Error | null = null;
  const startedAt = Date.now();
  const child = spawn(command!, args, { cwd, env: { ...process.env, KEYWORDS_AGENT_ID: executorId, KEYWORDS_OPERATION_ID: claim.operationId, KEYWORDS_PROJECT_ID: claim.projectId, KEYWORDS_WORK_SESSION_ID: claim.workSessionId ?? '' }, shell: false, stdio: ['pipe','inherit','pipe'] });
  activeChild = child;
  child.stderr.on('data', chunk => { const text = String(chunk); process.stderr.write(text); stderr = (stderr + text).slice(-20_000); });
  if (!hasPromptSlot) { child.stdin.write(prompt); child.stdin.end(); }
  const heartbeat = setInterval(() => void operationCommands.executorHeartbeat(agentCtx, { executorId, generation, leaseSeconds }).catch(error => console.error('Autopilot heartbeat failed:', error)), Math.min(60_000, leaseSeconds * 500));
  heartbeat.unref();
  const code = await new Promise<number | null>(resolve => {
    child.once('error', error => { spawnError = error; resolve(null); });
    child.once('exit', value => resolve(value));
  }).finally(() => { clearInterval(heartbeat); activeChild = null; });
  const elapsedMs = Date.now() - startedAt;
  const opCtx = { ...agentCtx, projectId: claim.projectId, workSessionId: claim.workSessionId ?? undefined };
  const failureText = `${spawnError?.message ?? ''}\n${stderr}\nexit code ${code ?? 'unknown'}`;
  if (code === 0 && !spawnError) {
    try { await closeFromWorkState(claim, opCtx); }
    catch (error) {
      console.error('Failed to reconcile completed agent work:', error);
      const text = error instanceof Error ? error.message : String(error);
      if (/required article artifacts are verified|artifact/i.test(text)) await headlessCommands.noteIncomplete(claim.operationId, claim.projectId, 'artifact_missing', text).catch(() => undefined);
    }
  } else {
    const failureClass = headlessCommands.classifyExecutorFailure(failureText);
    if (failureClass) {
      await headlessCommands.recordExecutorFailure({ executorId, generation, failureClass, message: failureText });
      console.error(`Executor ${executorId} entered cooldown for ${failureClass}; project ${claim.projectId} was not marked site-blocked.`);
    } else {
      try {
        await operationCommands.checkpoint({ ...opCtx, workSessionId: undefined }, { operationId: claim.operationId, projectId: claim.projectId, state: 'blocked', blockerClass: 'site_dependency_failed', summary: `Agent process could not finish the assigned site work (exit ${code ?? 'unknown'}).`, nextAction: 'Inspect the persisted site-specific blocker and retry the same operation after it is resolved.' });
      } catch (error) { console.error('Failed to checkpoint site-specific agent exit:', error); }
    }
  }
  try {
    const { getDatabase } = await import('@keywords/db');
    getDatabase().sqlite.prepare('UPDATE operation_projects SET runtime_consumed_ms=runtime_consumed_ms+?,updated_at=? WHERE operation_id=? AND project_id=?').run(elapsedMs, new Date().toISOString(), claim.operationId, claim.projectId);
  } catch (error) { console.error('Failed to record executor active runtime:', error); }
  await operationCommands.executorRelease(agentCtx, { executorId, generation, operationId: claim.operationId, projectId: claim.projectId }).catch(error => console.error('Executor release failed:', error));
  if (!stopping) await headlessCommands.runAutopilotTick(systemCtx, claim.projectId, { force: true }).catch(error => console.error('Post-operation autopilot tick failed:', error));
}

function requestShutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`Keywords autopilot runner received ${signal}; stopping new claims.`);
  if (activeChild && !activeChild.killed) {
    try { activeChild.kill('SIGTERM'); } catch (error) { console.error('Failed to signal active agent:', error); }
  }
}
process.once('SIGTERM', () => requestShutdown('SIGTERM'));
process.once('SIGINT', () => requestShutdown('SIGINT'));

let registration = await operationCommands.executorRegister(agentCtx, { executorId, capabilities: ['operation','research','planning','blog','article-artifact'], leaseSeconds });
console.log(`Keywords autopilot runner online as ${executorId} generation ${registration.generation}`);
while (!stopping) {
  try {
    const health = await headlessCommands.clearExecutorFailureIfDue(executorId);
    if (health?.status !== 'cooldown') {
      await headlessCommands.resumeEligibleOperations();
      await operationCommands.executorHeartbeat(agentCtx, { executorId, generation: registration.generation, leaseSeconds });
      const dueProjects = await headlessCommands.dueProjects();
      for (const projectId of dueProjects) {
        if (stopping) break;
        await headlessCommands.runAutopilotTick(systemCtx, projectId).catch(error => console.error(`Autopilot tick failed for ${projectId}:`, error));
      }
      if (!stopping) {
        const claim = await executorCommands.claimNext(agentCtx, { executorId, generation: registration.generation, leaseSeconds });
        if (claim.claimed) await runAgent(claim, registration.generation);
      }
    }
  } catch (error) {
    console.error('Autopilot runner cycle failed:', error);
    const failureClass = headlessCommands.classifyExecutorFailure(error);
    if (failureClass) await headlessCommands.recordExecutorFailure({ executorId, generation: registration.generation, failureClass, message: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
    else {
      try { registration = await operationCommands.executorRegister(agentCtx, { executorId, capabilities: ['operation','research','planning','blog','article-artifact'], leaseSeconds }); }
      catch (registrationError) { console.error('Executor re-registration failed:', registrationError); }
    }
  }
  if (!stopping) await sleep(pollSeconds * 1000);
}
console.log('Keywords autopilot runner stopped accepting work.');
