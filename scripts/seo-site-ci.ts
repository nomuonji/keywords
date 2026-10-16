import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { SeoTaskRecord } from '../packages/db/src/site-operations-schema.js';

const SAFE_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[a-f0-9]{40}$/;
const MAX_OUTPUT = 16_000;

async function command(bin: string, argv: string[], cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((fulfill, reject) => {
    const child = spawn(bin, argv, { cwd, shell: false, env: { ...process.env, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const append = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-MAX_OUTPUT); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      code === 0 ? fulfill(output) : reject(Error(`${bin} failed (${signal ?? code}): ${output.slice(-3000)}`));
    });
  });
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

function htmlPath(root: string, pathname: string): string[] {
  const path = decodeURIComponent(pathname);
  if (path.includes('\\') || path.split('/').includes('..') || /[\0\r\n]/.test(path)) throw Error('Unsafe target URL path');
  const slug = path.replace(/^\/+|\/+$/g, '');
  const candidates = slug
    ? [join(root, slug, 'index.html'), join(root, slug + '.html')]
    : [join(root, 'index.html')];
  return candidates.filter(candidate => resolve(candidate).startsWith(resolve(root) + '/'));
}

function canonicalOf(html: string): string | null {
  const tag = html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i)?.[0]
    ?? html.match(/<link\b[^>]*\bhref=["'][^"']+["'][^>]*\brel=["']canonical["'][^>]*>/i)?.[0];
  return tag?.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? null;
}

export async function verifySeoSiteBuild(task: SeoTaskRecord, sha: string): Promise<string> {
  if (!SAFE_REPO.test(task.repo) || !SHA.test(sha) || task.targetUrls.length === 0) {
    throw Error('Central CI needs a valid repository, exact commit SHA and target URLs');
  }
  const root = await mkdtemp(join(tmpdir(), 'seo-site-ci-'));
  try {
    await command('git', ['init', '--quiet'], root, 20_000);
    await command('git', ['remote', 'add', 'origin', `https://github.com/${task.repo}.git`], root, 20_000);
    await command('git', ['fetch', '--quiet', '--depth=1', 'origin', sha], root, 120_000);
    await command('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], root, 20_000);
    const head = (await command('git', ['rev-parse', 'HEAD'], root, 20_000)).trim();
    if (head !== sha) throw Error('Central CI checked out a different commit');

    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>; scripts?: Record<string, string>;
    };
    const astro = Boolean(pkg.dependencies?.astro);
    const docusaurus = Boolean(pkg.dependencies?.['@docusaurus/core']);
    const next = Boolean(pkg.dependencies?.next);
    if (!astro && !docusaurus && !next) throw Error('No approved site build profile for this repository');
    if (!pkg.scripts?.build) throw Error('Approved site profile lacks a build script');
    if (!(await exists(join(root, 'package-lock.json')))) throw Error('Central CI requires a committed package-lock.json');
    await command('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], root, 300_000);
    await command('npm', ['run', 'build'], root, 480_000);
    const output = astro ? join(root, 'dist') : docusaurus ? join(root, 'build') : join(root, '.next', 'server', 'app');
    if (!(await exists(output))) throw Error('Build succeeded without the expected generated HTML directory');

    for (const raw of task.targetUrls) {
      const url = new URL(raw);
      if (url.protocol !== 'https:') throw Error('Target URL must use HTTPS');
      const candidates = htmlPath(output, url.pathname);
      const file = (await Promise.all(candidates.map(exists))).findIndex(Boolean);
      if (file < 0) throw Error(`No generated HTML for target ${url.pathname}`);
      const html = await readFile(candidates[file], 'utf8');
      if (!/<(?:main|article|body)\b/i.test(html)) throw Error(`Generated HTML body missing at ${url.pathname}`);
      const canonical = canonicalOf(html);
      if (!canonical || new URL(canonical, raw).href !== url.href) {
        throw Error(`Canonical mismatch at ${url.pathname}: ${canonical ?? 'absent'}`);
      }
    }
    return `Central CI passed at exact ${head}: approved ${astro ? 'Astro' : docusaurus ? 'Docusaurus' : 'Next'} build and ${task.targetUrls.length} generated target/canonical checks.`;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
