import type { Command } from 'commander';
import type { CommandContext } from '@keywords/domain';
import { discoveryCommands } from '@keywords/commands/discovery';
import { workspaceCommands } from '@keywords/commands/workspace';
import { maintenanceCommands } from '@keywords/commands/maintenance';

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const csv = (value?: string) => value?.split(',').map(item => item.trim()).filter(Boolean) ?? [];
const agentCtx = (ctx: CommandContext) => ({ ...ctx, actor: 'agent' as const, actorId: `${ctx.actorId ?? 'cli'}:agent` });

export function registerProductCli(program: Command, ctx: CommandContext) {
  const workspace = program.command('workspace');
  workspace.command('brief').argument('<projectId>').action(async (projectId: string) => print(await workspaceCommands.brief(ctx, projectId)));
  workspace.command('capabilities').argument('<projectId>').action(async (projectId: string) => print(await workspaceCommands.capabilities(ctx, projectId)));
  workspace.command('configure').argument('<projectId>')
    .option('--mode <mode>', 'existing_site | topic_only').option('--domain <domain>').option('--topic <topic>').option('--audience <audience>')
    .option('--language <language>').option('--country <country>').option('--region <region>').option('--exclude <csv>')
    .option('--cadence-days <number>').option('--max-candidates <number>').option('--max-requests <number>')
    .action(async (projectId: string, opts: any) => print(await workspaceCommands.updateBrief(ctx, {
      projectId, mode: opts.mode, domain: opts.domain, topic: opts.topic, audience: opts.audience, language: opts.language, country: opts.country, region: opts.region,
      excludedTerms: opts.exclude === undefined ? undefined : csv(opts.exclude), discoveryCadenceDays: opts.cadenceDays ? Number(opts.cadenceDays) : undefined,
      discoveryMaxCandidates: opts.maxCandidates ? Number(opts.maxCandidates) : undefined, discoveryMaxExternalRequests: opts.maxRequests ? Number(opts.maxRequests) : undefined
    })));
  workspace.command('keywords').argument('<projectId>').option('--query <text>').option('--candidate-status <status>').option('--cluster <clusterId>').option('--limit <number>', 'Rows', '50').option('--offset <number>', 'Offset', '0')
    .action(async (projectId: string, opts: any) => print(await workspaceCommands.keywordSearch(ctx, { projectId, q: opts.query, candidateStatus: opts.candidateStatus, clusterId: opts.cluster, limit: Number(opts.limit), offset: Number(opts.offset) })));
  workspace.command('continuous').argument('<projectId>').action(async (projectId: string) => print(await workspaceCommands.continuousSummary(ctx, projectId)));

  const discovery = program.command('discovery');
  discovery.command('list').argument('<projectId>').action(async (projectId: string) => print(await discoveryCommands.list(ctx, projectId)));
  discovery.command('show').argument('<projectId>').argument('<jobId>').action(async (projectId: string, jobId: string) => print(await discoveryCommands.detail(ctx, { projectId, jobId })));
  discovery.command('start').argument('<projectId>').requiredOption('--goal <text>').option('--seeds <csv>').option('--url <url>').option('--language <language>').option('--country <country>').option('--region <region>').option('--exclude <csv>').option('--max-candidates <number>').option('--max-requests <number>')
    .action(async (projectId: string, opts: any) => print(await discoveryCommands.start(ctx, { projectId, goal: opts.goal, seedKeywords: csv(opts.seeds), targetUrl: opts.url, language: opts.language, country: opts.country, region: opts.region, excludedTerms: opts.exclude === undefined ? undefined : csv(opts.exclude), maxCandidates: opts.maxCandidates ? Number(opts.maxCandidates) : undefined, maxExternalRequests: opts.maxRequests ? Number(opts.maxRequests) : undefined })));
  discovery.command('claim').argument('<projectId>').argument('<jobId>').description('Claim as a local CLI agent for debugging/automation').action(async (projectId: string, jobId: string) => print(await discoveryCommands.claim(agentCtx(ctx), { projectId, jobId })));
  discovery.command('ads').argument('<projectId>').argument('<jobId>').option('--seeds <csv>').option('--url <url>').action(async (projectId: string, jobId: string, opts: any) => print(await discoveryCommands.adsIdeas(agentCtx(ctx), { projectId, jobId, seedKeywords: opts.seeds ? csv(opts.seeds) : undefined, url: opts.url })));
  discovery.command('serp').argument('<projectId>').argument('<jobId>').argument('<candidateId>').option('--num <number>', 'Results', '10').action(async (projectId: string, jobId: string, candidateId: string, opts: any) => print(await discoveryCommands.serp(agentCtx(ctx), { projectId, jobId, candidateId, num: Number(opts.num) })));
  discovery.command('finish').argument('<projectId>').argument('<jobId>').requiredOption('--summary <text>').action(async (projectId: string, jobId: string, opts: any) => print(await discoveryCommands.finishResearch(agentCtx(ctx), { projectId, jobId, summary: opts.summary })));
  discovery.command('review').argument('<projectId>').argument('<jobId>').argument('<candidateId>').argument('<status>', 'shortlisted | hold | rejected | research_more').option('--reason <text>').action(async (projectId: string, jobId: string, candidateId: string, status: any, opts: any) => print(await discoveryCommands.reviewCandidate(ctx, { projectId, jobId, candidateId, status, reason: opts.reason })));
  discovery.command('cancel').argument('<projectId>').argument('<jobId>').option('--reason <text>').action(async (projectId: string, jobId: string, opts: any) => print(await discoveryCommands.cancel(ctx, { projectId, jobId, reason: opts.reason })));

  const maintenance = program.command('maintenance');
  maintenance.command('diagnostics').action(async () => print(await maintenanceCommands.diagnostics(ctx)));
  maintenance.command('backup').option('--destination <path>').action(async (opts: any) => print(await maintenanceCommands.backup(ctx, { destination: opts.destination })));
}
