import type { VercelRequest, VercelResponse } from '@vercel/node';

let app: ((req: VercelRequest, res: VercelResponse) => void) | null = null;

function loadApp() {
  if (!app) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('../dist/server/app');
      app = mod.default ?? mod;
      if (typeof app !== 'function') {
        throw new Error('Express app module did not export a handler function');
      }
    } catch (error) {
      throw new Error('Server bundle not found. Run "npm run build" before deploying.', { cause: error });
    }
  }
  return app;
}

export default function handler(req: VercelRequest, res: VercelResponse): void {
  const expressApp = loadApp();
  expressApp(req, res);
}