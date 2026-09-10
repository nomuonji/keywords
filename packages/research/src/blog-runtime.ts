import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface BlogRuntime {
  root: string;
  buildCommand: string;
  collections: Array<{ root: string; extensions: string[]; url_template: string }>;
}

export function newBlogArticleTarget(runtime: BlogRuntime, origin: string, slug: string) {
  const markdown = runtime.collections.filter(item => item.extensions.some(extension => ['.md','.mdx','.mdoc','.markdown'].includes(extension)));
  if (markdown.length !== 1) throw new Error('New articles require one unambiguous Markdown collection in the site mapping');
  const collection = markdown[0], clean = slug.replace(/^\/+|\/+$/g, '');
  if (!clean || clean.split('/').some(part => part === '.' || part === '..') || /[\\?#:%]/.test(clean)) throw new Error('Article slug is not a safe mapped path');
  if (!collection.url_template.startsWith('/') || !collection.url_template.includes('{slug}') || /\{(?!slug\})/.test(collection.url_template)) throw new Error('Unsupported article URL template');
  const url = new URL(collection.url_template.replaceAll('{slug}', clean), origin);
  if (url.origin !== origin) throw new Error('Mapped article URL is outside the site');
  const extension = collection.extensions.find(value => ['.md','.mdx','.mdoc','.markdown'].includes(value))!;
  return { url: url.toString(), path: `${collection.root}/${clean}${extension}` };
}

/** Read existing human-maintained Blog configuration. Never infer a different site's root. */
export function readBlogRuntime(siteId: string, origin: string): BlogRuntime {
  const workspace = process.env.KEYWORDS_BLOG_WORKSPACE_ROOT?.trim();
  if (!workspace) {
    if (process.env.KEYWORDS_BLOG_SITE_ID !== siteId) throw new Error('Configure KEYWORDS_BLOG_WORKSPACE_ROOT for the bound site; a global article root cannot serve unrelated sites');
    const root = process.env.KEYWORDS_BLOG_ROOT?.trim();
    if (!root || !existsSync(root)) throw new Error('Configured Blog site root is unavailable');
    return { root: realpathSync(root), buildCommand: process.env.KEYWORDS_BLOG_BUILD_COMMAND?.trim() ?? '', collections: [] };
  }
  const base = resolve(workspace);
  const catalog = JSON.parse(readFileSync(join(base, '.seo-autopilot', 'sites.json'), 'utf8').replace(/^\uFEFF/, ''));
  const sites = (catalog.sites ?? []).filter((row: any) => row.id === siteId);
  if (sites.length !== 1 || typeof sites[0].path !== 'string' || !existsSync(resolve(base, sites[0].path))) throw new Error(`Blog site ${siteId} has no unique existing runtime path`);
  const mappings = join(base, '.seo-autopilot', 'integration', 'sites');
  const matches = readdirSync(mappings).filter(name => name.endsWith('.json')).flatMap(name => {
    const value = JSON.parse(readFileSync(join(mappings, name), 'utf8').replace(/^\uFEFF/, ''));
    return value.blog_site_id === siteId ? [value] : [];
  });
  if (matches.length !== 1 || matches[0].canonical_origin !== origin) throw new Error(`Blog mapping does not uniquely match ${siteId} and its bound origin`);
  return { root: realpathSync(resolve(base, sites[0].path)), buildCommand: typeof sites[0].build_command === 'string' ? sites[0].build_command.trim() : '',
    collections: (matches[0].collections ?? []).map((row: any) => ({ root: String(row.root), extensions: Array.isArray(row.extensions) ? row.extensions.map(String) : [], url_template: String(row.url_template ?? '') })) };
}
