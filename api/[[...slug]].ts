import type { VercelRequest, VercelResponse } from '@vercel/node';

type ExpressHandler = (req: VercelRequest, res: VercelResponse) => void;

let cachedApp: ExpressHandler | null = null;

function loadApp(): ExpressHandler {
  if (cachedApp) {
    return cachedApp;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../dist/server/app');
    const app: unknown = mod.default ?? mod;
    if (typeof app !== 'function') {
      throw new Error('Express app did not export a handler function');
    }
    cachedApp = app as ExpressHandler;
    return cachedApp;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load compiled server app', error);
    throw new Error('Cannot load compiled server app. Run "npm run build" before deploying.');
  }
}

export default function handler(req: VercelRequest, res: VercelResponse): void {
  const app = loadApp();
  app(req, res);
}
