const createHandler = require('../dist/server/app');

module.exports = function handler(req, res) {
  const app = typeof createHandler === 'function' ? createHandler : createHandler.default;
  if (typeof app !== 'function') {
    throw new Error('Express app bundle is invalid. Run "npm run build" to regenerate dist/server.');
  }
  const slugParam = req.query?.slug;
  const slug = Array.isArray(slugParam)
    ? `/${slugParam.join('/')}`
    : typeof slugParam === 'string'
      ? `/${slugParam}`
      : req.url ?? '/';
  req.url = slug;
  req.originalUrl = slug;
  app(req, res);
};
