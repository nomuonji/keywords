import type { VercelRequest, VercelResponse } from '@vercel/node';

let cachedApp: ((req: VercelRequest, res: VercelResponse) => void) | null = null;

function loadApp() {
  if (cachedApp) {
    return cachedApp;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../dist/server/app');
    const app = mod.default ?? mod;
    if (typeof app !== 'function') {
      throw new Error('Express app did not export a handler function');
    }
    cachedApp = app;
    return cachedApp;
  } catch (error) {
    throw new Error('Cannot load compiled server app. Run "npm run build" to generate dist/server.', {
      cause: error
    });
  }
}

export default function handler(req: VercelRequest, res: VercelResponse): void {
  const app = loadApp();
  app(req, res);
}
