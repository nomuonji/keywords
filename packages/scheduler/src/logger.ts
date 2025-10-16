import pino from 'pino';

export function createLogger(projectId: string) {
  return pino({
    name: 'scheduler',
    level: process.env.LOG_LEVEL ?? 'info',
    base: { projectId }
  });
}
