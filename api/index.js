/**
 * Vercel serverless entrypoint that re-uses the compiled Express app.
 * Make sure `npm run build` has been executed so apps/api/dist/app.js exists.
 */
let appModule;
try {
  appModule = require('../apps/api/dist/app');
} catch (error) {
  throw new Error(
    'Unable to load the compiled API from apps/api/dist/app.js. Run "npm run build" before deploying.',
    { cause: error }
  );
}

module.exports = appModule.default ?? appModule;
