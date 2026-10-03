const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '';
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? '';
const vercelEnv = process.env.VERCEL_ENV?.trim() ?? '';

if (vercelEnv && vercelEnv !== 'production') {
  console.log(`Cloudflare SEO preview policy: skip outside production deployment (VERCEL_ENV=${vercelEnv}).`);
  process.exit(0);
}

if (!accountId || !apiToken) {
  console.log('Cloudflare SEO preview policy: Cloudflare credentials unavailable in this build; skip.');
  process.exit(0);
}

const managedRepos = new Set([
  'nomuonji/omiyage-blog',
  'nomuonji/job-world',
  'nomuonji/shikaku-wiki',
  'nomuonji/whisky-media-en',
  'nomuonji/whisky-media-jp',
  'nomuonji/bungu-blog',
  'nomuonji/book-discovery',
  'nomuonji/otonano_reset-blog',
  'nomuonji/bloom-life',
  'nomuonji/tool-economics'
]);

type Envelope<T> = {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number; message?: string }>;
};

async function cf<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${apiToken}`,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {})
      }
    }
  );
  const body = await response.json().catch(() => null) as Envelope<T> | null;
  if (!response.ok || !body?.success) {
    const detail = body?.errors?.map(item => item.message || String(item.code ?? '')).filter(Boolean).join('; ');
    throw new Error(`Cloudflare API ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return body.result;
}

const projects = await cf<any[]>('/pages/projects');
let matched = 0;
let changed = 0;

for (const project of projects) {
  const source = project?.source;
  const config = source?.config ?? {};
  const owner = String(config.owner ?? '');
  const repoName = String(config.repo_name ?? '');
  const repo = owner && repoName ? `${owner}/${repoName}` : '';
  if (!managedRepos.has(repo)) continue;
  matched += 1;

  const currentSetting = config.preview_deployment_setting ?? 'all';
  const existingIncludes = Array.isArray(config.preview_branch_includes)
    ? config.preview_branch_includes.filter((value: unknown) => typeof value === 'string' && value.trim())
    : [];
  const existingExcludes = Array.isArray(config.preview_branch_excludes)
    ? config.preview_branch_excludes.filter((value: unknown) => typeof value === 'string' && value.trim())
    : [];

  if (currentSetting === 'none') {
    console.log(`Cloudflare SEO preview policy: ${project.name} already disables all preview deployments.`);
    continue;
  }

  const nextIncludes = existingIncludes.length ? existingIncludes : ['*'];
  const nextExcludes = [...new Set([...existingExcludes, 'seo/*'])];
  const alreadyApplied =
    currentSetting === 'custom'
    && nextExcludes.length === existingExcludes.length
    && existingExcludes.includes('seo/*');

  if (alreadyApplied) {
    console.log(`Cloudflare SEO preview policy: ${project.name} already excludes seo/*.`);
    continue;
  }

  const updated = await cf<any>(`/pages/projects/${encodeURIComponent(project.name)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      source: {
        type: source?.type ?? 'github',
        config: {
          preview_deployment_setting: 'custom',
          preview_branch_includes: nextIncludes,
          preview_branch_excludes: nextExcludes
        }
      }
    })
  });

  const updatedConfig = updated?.source?.config ?? {};
  if (updatedConfig.preview_deployment_setting !== 'custom'
      || !Array.isArray(updatedConfig.preview_branch_excludes)
      || !updatedConfig.preview_branch_excludes.includes('seo/*')) {
    throw new Error(`Cloudflare SEO preview policy did not persist for ${project.name}`);
  }

  changed += 1;
  console.log(`Cloudflare SEO preview policy: updated ${project.name} (${repo}) to exclude seo/* previews.`);
}

if (matched !== managedRepos.size) {
  const found = projects
    .map(project => {
      const config = project?.source?.config ?? {};
      const owner = String(config.owner ?? '');
      const repoName = String(config.repo_name ?? '');
      return owner && repoName ? `${owner}/${repoName}` : '';
    })
    .filter(Boolean);
  const missing = [...managedRepos].filter(repo => !found.includes(repo));
  console.log(`Cloudflare SEO preview policy: matched ${matched}/${managedRepos.size}; unresolved repositories: ${missing.join(', ') || 'none'}.`);
} else {
  console.log(`Cloudflare SEO preview policy: matched all ${matched} managed Pages projects; changed ${changed}.`);
}
