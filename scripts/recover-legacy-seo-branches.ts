import { seoTaskClaim, seoTaskGet, seoTaskUpdate } from '../packages/commands/src/remote-site-operations.js';

const token = process.env.SEO_DELIVERY_GITHUB_TOKEN?.trim() ?? '';
if (!token) throw new Error('SEO_DELIVERY_GITHUB_TOKEN is required');

const recoveries = [
  ['54ed2ac7-a33b-446b-8a3f-5a5e44aba907','nomuonji/book-discovery','seo/lonely-city-reader-fit',['src/data/categories/nonfiction.json','src/data/recommendations.json']],
  ['5fbca7ee-03b7-4047-90eb-bf530799c99b','nomuonji/otonano_reset-blog','seo/sleep-apps-selection-modes',['src/content/blog/sleep-apps-guide.md']],
  ['838dfd88-e9a5-41c1-81be-258829cbe065','nomuonji/shikaku-wiki','seo/aws-clf-validity-recert',['docs/technology/General/aws-cloud-practitioner.md']],
  ['2cd85c50-b7b9-4952-8efd-55a3dc9b3c78','nomuonji/omiyage-blog','seo/konbini-limited-labels-2cd85c50',['src/content/blog/2026-08-07-konbini-essay.mdx']],
  ['73f34584-57a6-49c7-aa63-7fd906dc48a6','nomuonji/whisky-media-jp','seo/jim-beam-white-source-ready',['src/content/whiskies/jim-beam-white.json']],
  ['11769a33-cb0b-49c5-980d-d371f8499004','nomuonji/job-world','seo/chocolate-maker-credential-facet',['src/data/jobs/food-fermentation.json','src/data/generated/neighbors.json','src/data/generated/stats.json','src/data/generated/tag-index.json','src/data/generated/taxonomy.json']],
  ['015b9666-2a06-43e9-a645-362782689080','nomuonji/shikaku-wiki','seo/engei-soushoku-2kyuu-source-boundary',['docs/creative/Design/engei-soushoku-ginoushi-2kyuu.md']],
  ['d710711d-46df-4891-96c1-afd2ed6e81f4','nomuonji/chonmage-en','seo/itoi-ruka-source-audit',['src/content/blog/itoi-ruka.mdx']],
  ['3f1a670b-ad44-4912-a09f-3f567648c87d','nomuonji/bungu-blog','seo/md-notebook-fit-guide',['src/content/blog/2026-08-07-midori-md-notebook-review.mdx']],
  ['f0bb07ef-9357-4cca-a9b6-a2eb96156c6e','nomuonji/job-world','seo/falconer-career-legal-boundaries',['src/data/jobs/nature.json']],
  ['ab553fa7-ad48-4f6f-a928-ff2f3444df28','nomuonji/otonano_reset-blog','seo/sleep-supplement-vs-medicine',['src/content/blog/sleep-supplements-guide.md']],
  ['4daa98c7-e3cf-44ed-b1d2-fea482c12810','nomuonji/omiyage-blog','seo/sakura-label-guide-4daa98c7',['src/content/blog/2026-08-10-sakura-snacks-decoded.mdx']],
  ['02bed61f-b04f-48db-a7e9-3950e1f302d3','nomuonji/shikaku-wiki','seo/ashiba-shuninsha-official-20261003',['docs/safety-environment/General/ashiba-no-kumitatetou-sagyou-shuninsha.md']],
  ['67e642b9-7135-46a7-b44d-09f50d5dcdf6','nomuonji/kampo-wiki','seo/yokuinin-regulator-evidence',['docs/herbs/yokuinin.md']],
  ['5b239f4e-0991-4ef1-affa-c16d1d09b6b1','nomuonji/book-discovery','seo/a-little-life-ja-edition-status',['src/app/books/[slug]/page.tsx','src/data/categories/contemporary-fiction.json','src/types/index.ts']],
  ['6070d4a7-5a1a-4326-b1d5-3361a843ea2d','nomuonji/free-consult-blog','seo/6070d4a7-semantic-title-breadcrumb',['scripts/test-display-name.mjs','src/lib/displayName.ts','src/pages/[category]/[id].astro']],
  ['e79f184b-321c-4b7c-a186-52e560b46d17','nomuonji/tool-economics','seo/netlify-free-plan-record',['src/data/candidates.json','src/data/tools.json']],
  ['d639cec4-2a6a-4c79-9b8e-d497da215304','nomuonji/shikaku-wiki','seo/cdl-official-syllabus-d639cec4',['docs/technology/General/google-cloud-digital-leader.md']],
  ['b753655e-d16e-432a-93ee-af0383ea3006','nomuonji/bungu-blog','seo/hobonichi-techo-definition-b753655e',['src/content/blog/2026-08-16-hobonichi-techo-guide.mdx']],
  ['c891e0e6-d91f-4ec0-aeb8-855e400d84ac','nomuonji/job-world','seo/letterpress-katsuji-ko-definition',['src/data/jobs/publishing.json']],
  ['7178507e-d064-4101-abae-cecf67904150','nomuonji/chonmage-en','seo/jav-actresses-claim-audit-7178507e',['src/content/blog/jav-actresses-explained.md']],
  ['d9aa7d7b-6aec-4975-a01e-fd2cb98a1159','nomuonji/book-discovery','seo/the-stranger-summary-scope',['src/data/categories/philosophy.json']],
  ['49685f34-e3bd-4a13-b406-9ad0c43305ee','nomuonji/kampo-wiki','seo/bukuryo-scope-separation',['docs/herbs/bukuryo.md']],
  ['c09ff3b0-333a-4654-ba27-e304c60b47b9','nomuonji/miai-no-atode','seo/c09ff3b0-omiai-hiyou-plan-totals',['src/content/blog/2026-09-15-omiai-hiyou-souba.md']]
] as const;

const ghHeaders = {
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${token}`,
  'x-github-api-version': '2022-11-28',
  'user-agent': 'keywords-legacy-seo-branch-recovery'
};

async function gh<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: ghHeaders });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${body?.message ?? text}`);
  return body as T;
}
const api=(repo:string,suffix='')=>`https://api.github.com/repos/${repo}${suffix}`;

for (const [id, repo, branch, allowedFiles] of recoveries) {
  const task:any = await seoTaskGet({ id });
  if (task.status === 'completed' || ['branch_ready','pr_open','merged'].includes(task.deliveryHandoff?.state ?? 'none')) {
    console.log(`SKIP ${id}: already delivered/completed`);
    continue;
  }
  if (task.status !== 'ready' || task.executionClaim) {
    console.log(`SKIP ${id}: status=${task.status}; claim=${Boolean(task.executionClaim)}`);
    continue;
  }

  const repoInfo = await gh<{default_branch:string}>(api(repo));
  const ref = await gh<{object:{sha:string}}>(api(repo,`/git/ref/heads/${encodeURIComponent(branch)}`));
  const headSha=ref.object.sha.toLowerCase();
  const cmp = await gh<any>(api(repo,`/compare/${encodeURIComponent(repoInfo.default_branch)}...${headSha}`));
  const changed=(cmp.files??[]).map((f:any)=>String(f.filename)).sort();
  const allowed=[...allowedFiles].sort();
  const exact = changed.length===allowed.length && changed.every((f:string,i:number)=>f===allowed[i]);
  if (!exact || Number(cmp.ahead_by??0) < 1) {
    console.log(`SKIP_SCOPE ${id}: ahead=${cmp.ahead_by}; changed=${JSON.stringify(changed)}; allowed=${JSON.stringify(allowed)}`);
    continue;
  }
  const baseSha=String(cmp.merge_base_commit?.sha??'').toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(baseSha)) {
    console.log(`SKIP_BASE ${id}: invalid merge base ${baseSha}`);
    continue;
  }

  const runId=`recover-legacy-${id}`.slice(0,120);
  const claimed:any=await seoTaskClaim({
    id,expectedRevision:task.revision,runId,actor:'seo_delivery_branch_recovery',leaseMinutes:15
  });
  const at=new Date().toISOString();
  const updated:any=await seoTaskUpdate({
    id,expectedRevision:claimed.revision,claimRunId:runId,
    deliveryHandoff:{
      state:'branch_ready',branch,headSha,baseSha,
      validationSummary:`Recovered legacy Worker branch after direct GitHub inspection. Branch is ahead of current default-branch history and changed-file scope exactly matches the task-specific allowlist: ${changed.join(', ')}. Central PR CI remains the merge gate.`,
      handedOffAt:at,prNumber:null,prUrl:null,lastError:'',updatedAt:at
    },
    executionSummary:[
      task.executionSummary,
      `Recovered legacy pushed branch ${branch}@${headSha}; exact changed-file scope verified; handed to central delivery without rerunning Worker.`
    ].filter(Boolean).join('\n'),
    appendHistory:{
      actor:'seo_delivery_branch_recovery',event:'delivery_handoff_ready',
      detail:`Recovered previously unrecorded branch push after GitHub diff verification: branch=${branch}; head=${headSha}; mergeBase=${baseSha}; files=${changed.join(', ')}.`
    }
  });
  console.log(`RECOVERED ${id} ${repo} ${branch}@${headSha}; revision=${updated.revision}`);
}
