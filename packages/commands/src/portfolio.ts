import { getDatabase, schema } from '@keywords/db';
import { hostOf, readPortfolio } from '@keywords/research/portfolio';
import { headlessCommands } from './headless.js';

export const portfolioCommands = {
  async context() {
    const [snapshot, articles] = await Promise.all([readPortfolio(), headlessCommands.dashboard()]);
    const { db } = getDatabase();
    const projects = await db.select().from(schema.projects);
    const tasks = await db.select().from(schema.tasks);
    const reviews = await db.select().from(schema.reviewRequests);
    const sites = [...snapshot.sites];
    for (const project of projects) {
      const host = hostOf(project.domain);
      if (host && !sites.some(site => site.host === host)) sites.push({ name: project.name, host, error: false, gsc: { current: null, previous: null }, ga4: { current: null, previous: null } });
    }
    return { ...snapshot, articles, sites: sites.map(site => {
      const matches = projects.filter(project => hostOf(project.domain) === site.host);
      const projectIds = new Set(matches.map(project => project.id));
      const openTasks = tasks.filter(task => projectIds.has(task.projectId) && !['done', 'cancelled'].includes(task.status)).length;
      const openReviews = reviews.filter(review => projectIds.has(review.projectId) && review.status === 'open').length;
      const current = site.error ? null : site.gsc.current?.clicks ?? null;
      const previous = site.error ? null : site.gsc.previous?.clicks ?? null;
      const clickChange = snapshot.comparable && current !== null && previous !== null && previous > 0 ? (current - previous) / previous * 100 : null;
      const sessions = site.error ? null : site.ga4.current?.sessions ?? null;
      const previousSessions = site.error ? null : site.ga4.previous?.sessions ?? null;
      const sessionChange = snapshot.comparable && sessions !== null && previousSessions !== null && previousSessions > 0 ? (sessions - previousSessions) / previousSessions * 100 : null;
      const signal = site.error ? '取得失敗' : snapshot.stale ? 'データ更新が必要' : openReviews ? 'レビュー待ち' : clickChange !== null && previous! >= 5 && clickChange <= -30 ? '検索流入の減少を確認' : sessionChange !== null && previousSessions! >= 20 && sessionChange <= -30 ? '訪問減少を確認' : current === null ? '検索データなし' : '実績を確認';
      return { ...site, clickChange, sessionChange, signal, projects: matches.map(p => ({ id: p.id, name: p.name })), openTasks, openReviews };
    }) };
  }
};
