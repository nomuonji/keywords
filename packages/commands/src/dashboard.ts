import type { CommandContext } from '@keywords/domain';
import { autopilotCommands } from './autopilot.js';
import { operationCommands } from './operation.js';
import { portfolioCommands } from './portfolio.js';

type SectionError = { section: 'autopilot' | 'portfolio' | 'operations'; message: string };
const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export const dashboardCommands = {
  async context(ctx: CommandContext) {
    const [autopilotResult, portfolioResult, operationsResult] = await Promise.allSettled([
      autopilotCommands.portfolio(),
      portfolioCommands.context(),
      operationCommands.context(ctx, {})
    ]);
    const errors: SectionError[] = [];
    if (autopilotResult.status === 'rejected') errors.push({ section: 'autopilot', message: messageOf(autopilotResult.reason) });
    if (portfolioResult.status === 'rejected') errors.push({ section: 'portfolio', message: messageOf(portfolioResult.reason) });
    if (operationsResult.status === 'rejected') errors.push({ section: 'operations', message: messageOf(operationsResult.reason) });

    const autopilot = autopilotResult.status === 'fulfilled' ? autopilotResult.value : null;
    const portfolio: any = portfolioResult.status === 'fulfilled' ? portfolioResult.value : null;
    const operations: any = operationsResult.status === 'fulfilled' ? operationsResult.value : null;
    return {
      generatedAt: new Date().toISOString(),
      errors,
      autopilot: autopilot ? {
        generatedAt: autopilot.generatedAt,
        scheduler: autopilot.scheduler,
        totals: autopilot.totals,
        projects: autopilot.projects.map((project: any) => ({
          id: project.id, name: project.name, domain: project.domain, mode: project.mode, environment: project.environment,
          control: project.control, state: project.state, activeOperation: project.activeOperation, executor: project.executor,
          recovery: project.recovery ? { state: project.recovery.state, newContentAllowed: project.recovery.newContentAllowed, summary: project.recovery.summary, nextObservationAt: project.recovery.nextObservationAt, observedAt: project.recovery.observedAt } : null,
          openReviews: project.openReviews, qualityQueue: project.qualityQueue
        }))
      } : null,
      portfolio: portfolio ? {
        generatedAt: portfolio.generatedAt, stale: Boolean(portfolio.stale), period: portfolio.period,
        sites: portfolio.sites ?? [],
        articles: { inProgress: (portfolio.articles?.inProgress ?? []).slice(0, 50), complete: (portfolio.articles?.complete ?? []).slice(0, 50) },
        keywordChoices: (portfolio.keywordChoices ?? []).slice(0, 50)
      } : null,
      operations: operations ? { generatedAt: operations.generatedAt, outcomes: (operations.outcomes ?? []).slice(0, 50) } : null
    };
  }
};
