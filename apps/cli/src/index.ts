import { Command } from 'commander';
import { commands } from '@keywords/commands';
import { planningCommands } from '@keywords/commands/planning';
import { policyCommands } from '@keywords/commands/policy';
const program = new Command();
const ctx = { actor: 'human' as const, actorId: process.env.USER ?? 'cli' };
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const csv = (value?: string) => value?.split(',').map(item => item.trim()).filter(Boolean) ?? [];
program.name('keywords').description('Agent-native SEO workspace CLI');
const project = program.command('project');
project.command('list').action(async () => print(await commands.project.list(ctx)));
project.command('create').argument('<name>').option('--domain <domain>').action(async (name: string, opts: {domain?: string}) => print(await commands.project.create(ctx, { name, domain: opts.domain })));
project.command('snapshot').argument('<projectId>').action(async (projectId: string) => print(await commands.project.snapshot(ctx, projectId)));
const policy = program.command('policy');
policy.command('context').argument('<projectId>').option('--decisions <number>', 'Recent decisions to include', '30').action(async (projectId: string, opts: {decisions: string}) => print(await policyCommands.context(ctx, projectId, Number(opts.decisions))));
policy.command('list').argument('<projectId>').option('--status <status>').action(async (projectId: string, opts: {status?: string}) => print(await policyCommands.list(ctx, projectId, opts.status)));
policy.command('propose').argument('<projectId>').argument('<rule>').requiredOption('--decisions <ids>', 'Comma-separated source decision IDs').option('--scope <scope>').option('--rationale <text>').action(async (projectId: string, rule: string, opts: {decisions: string; scope?: string; rationale?: string}) => print(await policyCommands.propose(ctx, { projectId, rule, scope: opts.scope, rationale: opts.rationale, sourceDecisionIds: csv(opts.decisions) })));
policy.command('review').argument('<projectId>').argument('<policyId>').argument('<verdict>', 'active | rejected').option('--reason <reason>').action(async (projectId: string, policyId: string, verdict: 'active'|'rejected', opts: {reason?: string}) => print(await policyCommands.review(ctx, { projectId, policyId, verdict, reason: opts.reason })));
policy.command('retire').argument('<projectId>').argument('<policyId>').requiredOption('--reason <reason>').action(async (projectId: string, policyId: string, opts: {reason: string}) => print(await policyCommands.retire(ctx, { projectId, policyId, reason: opts.reason })));
const source = program.command('source');
source.command('list').argument('<projectId>').option('--type <type>').action(async (projectId: string, opts: {type?: string}) => print(await commands.source.list(ctx, projectId, opts.type)));
const research = program.command('research');
research.command('context').argument('<projectId>').action(async (projectId: string) => print(await commands.research.context(ctx, projectId)));
research.command('opportunities').argument('<projectId>').option('--limit <number>', 'Maximum rows per opportunity bucket', '25').action(async (projectId: string, opts: {limit: string}) => print(await commands.research.opportunities(ctx, projectId, Number(opts.limit))));
research.command('web').argument('<projectId>').argument('<url>').option('--max-chars <number>').action(async (projectId: string, url: string, opts: {maxChars?: string}) => print(await commands.research.webFetch(ctx, { projectId, url, maxChars: opts.maxChars ? Number(opts.maxChars) : undefined })));
research.command('serp').argument('<projectId>').argument('<query>').option('--country <country>').option('--language <language>').option('--location <location>').option('--num <number>').action(async (projectId: string, query: string, opts: {country?: string; language?: string; location?: string; num?: string}) => print(await commands.research.serp(ctx, { projectId, query, country: opts.country, language: opts.language, location: opts.location, num: opts.num ? Number(opts.num) : undefined })));
research.command('ads').argument('<projectId>').argument('[seeds...]').option('--url <url>').option('--customer <customerId>').option('--language-id <id>').option('--geo <ids>').option('--no-import').action(async (projectId: string, seeds: string[] | undefined, opts: {url?: string; customer?: string; languageId?: string; geo?: string; import: boolean}) => print(await commands.research.googleAdsKeywordIdeas(ctx, { projectId, customerId: opts.customer, seedKeywords: seeds ?? [], url: opts.url, languageId: opts.languageId, geoTargetIds: csv(opts.geo), importKeywords: opts.import })));
research.command('gsc').argument('<projectId>').argument('<startDate>').argument('<endDate>').option('--site <siteUrl>').option('--dimensions <csv>', 'Comma-separated dimensions', 'query').option('--row-limit <number>').option('--search-type <type>').option('--no-import').action(async (projectId: string, startDate: string, endDate: string, opts: {site?: string; dimensions: string; rowLimit?: string; searchType?: string; import: boolean}) => print(await commands.research.searchConsole(ctx, { projectId, siteUrl: opts.site, startDate, endDate, dimensions: csv(opts.dimensions), rowLimit: opts.rowLimit ? Number(opts.rowLimit) : undefined, searchType: opts.searchType, importQueries: opts.import })));
const keyword = program.command('keyword');
keyword.command('list').argument('<projectId>').action(async (projectId: string) => print(await commands.keyword.list(ctx, projectId)));
keyword.command('add').argument('<projectId>').argument('<text>').option('--volume <number>').action(async (projectId: string, text: string, opts: {volume?: string}) => print(await commands.keyword.create(ctx, { projectId, text, avgMonthly: opts.volume ? Number(opts.volume) : undefined })));
keyword.command('reject').argument('<projectId>').argument('<keywordId>').option('--reason <reason>').action(async (projectId: string, keywordId: string, opts: {reason?: string}) => print(await commands.keyword.reject(ctx, { projectId, keywordId, reason: opts.reason })));
const cluster = program.command('cluster');
cluster.command('list').argument('<projectId>').action(async (projectId: string) => print(await commands.cluster.list(ctx, projectId)));
cluster.command('create').argument('<projectId>').argument('<title>').option('--intent <intent>').action(async (projectId: string, title: string, opts: {intent?: string}) => print(await commands.cluster.create(ctx, { projectId, title, intent: opts.intent })));
cluster.command('assign').argument('<projectId>').argument('<clusterId>').requiredOption('--keywords <ids>', 'Comma-separated keyword IDs').action(async (projectId: string, clusterId: string, opts: {keywords: string}) => print(await planningCommands.clusterBulkAssign(ctx, { projectId, clusterId, keywordIds: csv(opts.keywords) })));
const page = program.command('page');
page.command('list').argument('<projectId>').action(async (projectId: string) => print(await commands.page.list(ctx, projectId)));
page.command('plan').argument('<projectId>').argument('<title>')
  .option('--cluster <clusterId>').option('--slug <slug>').option('--kind <kind>').option('--rationale <text>')
  .option('--primary <keywordId>').option('--secondary <ids>', 'Comma-separated keyword IDs').option('--sources <ids>', 'Comma-separated source IDs')
  .action(async (projectId: string, title: string, opts: {cluster?: string; slug?: string; kind?: string; rationale?: string; primary?: string; secondary?: string; sources?: string}) => print(await planningCommands.pagePlan(ctx, { projectId, title, clusterId: opts.cluster, slug: opts.slug, kind: opts.kind, rationale: opts.rationale, primaryKeywordId: opts.primary, secondaryKeywordIds: csv(opts.secondary), sourceIds: csv(opts.sources) })));
page.command('targets').argument('<projectId>').argument('<pageId>').action(async (projectId: string, pageId: string) => print(await planningCommands.pageTargets(ctx, { projectId, pageId })));
page.command('cannibalization').argument('<projectId>').option('--limit <number>', 'Maximum conflict groups', '50').action(async (projectId: string, opts: {limit: string}) => print(await planningCommands.pageCannibalization(ctx, { projectId, limit: Number(opts.limit) })));
page.command('review').argument('<projectId>').argument('<pageId>').argument('<verdict>', 'approved | rejected | needs_edit')
  .option('--reason <reason>').option('--override-conflicts')
  .action(async (projectId: string, pageId: string, verdict: 'approved'|'rejected'|'needs_edit', opts: {reason?: string; overrideConflicts?: boolean}) => print(await planningCommands.pageReview(ctx, { projectId, pageId, verdict, reason: opts.reason, overrideConflicts: opts.overrideConflicts })));
const task = program.command('task');
task.command('list').argument('<projectId>').action(async (projectId: string) => print(await commands.task.list(ctx, projectId)));
task.command('add').argument('<projectId>').argument('<title>').option('--priority <number>').action(async (projectId: string, title: string, opts: {priority?: string}) => print(await commands.task.create(ctx, { projectId, title, priority: opts.priority ? Number(opts.priority) : undefined })));
await program.parseAsync();
