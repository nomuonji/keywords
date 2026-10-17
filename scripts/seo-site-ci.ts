import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { SeoTaskRecord } from '../packages/db/src/site-operations-schema.js';

const SAFE_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[a-f0-9]{40}$/;
const MAX_OUTPUT = 16_000;

async function command(bin: string, argv: string[], cwd: string, timeoutMs: number, extraEnv: Record<string, string> = {}): Promise<string> {
  return new Promise((fulfill, reject) => {
    const child = spawn(bin, argv, { cwd, shell: false, env: { ...process.env, CI: '1', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
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

export function verifyGeneratedPage(
  html: string, raw: string,
  checks: readonly { url: string; containsText: string; internalLinks: readonly string[] }[]
): void {
  const url = new URL(raw);
  if (!/<(?:main|article|body)\b/i.test(html)) throw Error(`Generated HTML body missing at ${url.pathname}`);
  const canonical = canonicalOf(html);
  // Static site generators routinely canonicalize the same page to a final
  // slash. Preserve origin, path segments, query and scheme verification.
  const normalized = (value: string) => {
    const parsed = new URL(value, raw);
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.href;
  };
  if (!canonical || normalized(canonical) !== normalized(raw)) {
    throw Error(`Canonical mismatch at ${url.pathname}: ${canonical ?? 'absent'}`);
  }
  for (const check of checks) {
    if (check.url !== raw || !html.includes(check.containsText)) throw Error(`Required page text missing at ${url.pathname}`);
    for (const link of check.internalLinks) {
      if (!html.includes(link) && !html.includes(new URL(link).pathname)) {
        throw Error(`Required internal link missing at ${url.pathname}`);
      }
    }
  }
}

export async function verifySeoSiteBuild(task: SeoTaskRecord, sha: string): Promise<string> {
  if (!SAFE_REPO.test(task.repo) || !SHA.test(sha) || task.targetUrls.length === 0) {
    throw Error('Central CI needs a valid repository, exact commit SHA and target URLs');
  }
  // Hosted Actions may run the Docker daemon outside the runner's /tmp mount.
  // Place the isolated source below GITHUB_WORKSPACE so its bind mount is visible.
  const root = await mkdtemp(join(process.env.GITHUB_WORKSPACE ?? tmpdir(), '.seo-site-ci-'));
  try {
    await command('git', ['init', '--quiet'], root, 20_000);
    await command('git', ['remote', 'add', 'origin', `https://github.com/${task.repo}.git`], root, 20_000);
    // Managed site repositories can be private. Authorize *only* the Git fetch
    // with the existing delivery token. Keep the remote URL/token out of logs
    // and never forward these Git credential variables into the Docker build.
    const gitToken = process.env.SEO_DELIVERY_GITHUB_TOKEN?.trim();
    const fetchEnv = gitToken ? {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${gitToken}`).toString('base64')}`
    } : {};
    await command('git', ['fetch', '--quiet', '--depth=1', 'origin', sha], root, 120_000, fetchEnv);
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
    // Build untrusted site source without forwarding controller credentials.
    // Docker daemons behind hosted Actions runners may not share the runner's
    // filesystem: docker cp streams the checkout instead of relying on a bind
    // mount that silently exposes an empty /work.
    // Docker cp may preserve read-only ownership/modes from the Actions checkout.
    // Grant the container owner write access inside this disposable, credential-free
    // source copy so site OG/sitemap generators can overwrite generated assets.
    const generated = astro ? 'dist' : docusaurus ? 'build' : '.next/server/app';
    const output = join(root, generated);
    let containerId = '';
    try {
      const createOutput = await command('docker', [
        'create', '--security-opt=no-new-privileges', '--cap-drop=ALL',
        '--pids-limit=256', '--memory=4g', '--cpus=2',
        '-w', '/work', 'node:22-bookworm',
        'sh', '-lc', 'chmod -R u+rwX /work && npm ci --no-audit --no-fund && npm run build'
      ], root, 120_000);
      // docker create may emit image-pull logs before its 64-hex container ID.
      containerId = createOutput.split(/\r?\n/).map(line => line.trim()).filter(line => /^[a-f0-9]{64}$/.test(line)).pop() ?? '';
      if (!containerId) throw Error(`Docker create returned no container ID: ${createOutput.slice(-400)}`);
      // The '/.' copies the contents, not an extra nested source directory.
      await command('docker', ['cp', `${root}/.`, `${containerId}:/work`], root, 120_000);
      const buildLog = await command('docker', ['start', '-a', containerId], root, 780_000);
      const exitCode = (await command('docker', ['inspect', '-f', '{{.State.ExitCode}}', containerId], root, 20_000)).trim();
      if (exitCode !== '0') throw Error(`Isolated site build failed (${exitCode}): ${buildLog.slice(-3000)}`);
      await mkdir(dirname(output), { recursive: true });
      await command('docker', ['cp', `${containerId}:/work/${generated}`, output], root, 120_000);
    } finally {
      if (containerId) {
        try { await command('docker', ['rm', '-f', containerId], root, 20_000); }
        catch (error) { console.warn(`Docker container cleanup failed: ${String(error)}`); }
      }
    }
    if (!(await exists(output))) throw Error('Build succeeded without the expected generated HTML directory');

    for (const raw of task.targetUrls) {
      const url = new URL(raw);
      if (url.protocol !== 'https:') throw Error('Target URL must use HTTPS');
      const candidates = htmlPath(output, url.pathname);
      const file = (await Promise.all(candidates.map(exists))).findIndex(Boolean);
      if (file < 0) throw Error(`No generated HTML for target ${url.pathname}`);
      const html = await readFile(candidates[file], 'utf8');
      // Optional text/link assertions supplement real build, route and canonical checks.
      verifyGeneratedPage(html, raw, (task.acceptanceChecks ?? []).filter(check => check.url === raw));
    }
    return `Central CI passed at exact ${head}: approved ${astro ? 'Astro' : docusaurus ? 'Docusaurus' : 'Next'} build and ${task.targetUrls.length} generated target/canonical checks.`;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
