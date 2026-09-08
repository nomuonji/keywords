export const BUDGETED_COMMANDS = new Set([
  'blog.import_context', 'blog.prepare', 'blog.export', 'blog.receipt', 'blog.capture',
  'discovery.expand', 'discovery.observe',
  'source.record',
  'research.web_fetch',
  'research.serp',
  'research.google_ads_keyword_ideas',
  'research.search_console',
  'site.sync_sitemap',
  'metrics.capture',
  'discovery.import_candidates',
  'discovery.ads_ideas',
  'discovery.serp',
  'discovery.web_evidence',
  'discovery.annotate',
  'keyword.create',
  'keyword.reject',
  'cluster.create',
  'cluster.add_keyword',
  'cluster.bulk_assign',
  'page.plan',
  'insight.create',
  'task.create',
  'task.set_status',
  'policy.propose',
  'decision.record'
]);

export const isBudgetedCommand = (command: string) => BUDGETED_COMMANDS.has(command);
