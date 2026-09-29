import { Hono } from 'hono';
import { seoTaskList } from '../packages/commands/src/remote-site-operations.js';
import { seoAgentContext } from '../packages/commands/src/seo-agent-policy.js';

// Bounded read-only task feed for the human UI. It intentionally returns a
// compact projection rather than the full evidence/history payload.
const app = new Hono();
app.get('/api/remote-seo-tasks', async c => {
  const limit = Math.max(1, Math.min(Number(c.req.query('limit') ?? 60), 100));
  const result = await seoTaskList({ limit });
  const tasks = result.items.map(task => ({
    id: task.id,
    siteId: task.siteId,
    repo: task.repo,
    taskType: task.taskType,
    status: task.status,
    priority: task.priority,
    title: task.title,
    targetUrls: task.targetUrls,
    articleCount: task.articleIds.length,
    issueNumber: task.issueNumber,
    issueUrl: task.issueUrl,
    issueState: task.issueState,
    resultCommitSha: task.resultCommitSha,
    executionSummary: task.executionSummary,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    lastHistory: task.history?.at(-1) ?? null
  }));
  const planner = seoAgentContext({ role: 'planner' });
  return c.json({
    generatedAt: new Date().toISOString(),
    policyVersion: planner.policyVersion,
    taskCount: tasks.length,
    tasks
  }, 200, { 'cache-control': 'no-store' });
});
export default app;
