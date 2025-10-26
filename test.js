const path = require('node:path');

try {
  require('./dist/server/lib/blogger');
  console.log('Successfully imported blogger lib (built)');
} catch (e) {
  try {
    process.env.TS_NODE_PROJECT =
      process.env.TS_NODE_PROJECT || path.resolve(__dirname, 'tsconfig.server.json');
    require('ts-node/register');
    require('./server/lib/blogger');
    console.log('Successfully imported blogger lib (ts)');
  } catch (inner) {
    console.error('Failed to import blogger lib', inner);
  }
}

try {
  require('./dist/server/lib/blogger/media');
  console.log('Successfully imported blogger media (built)');
} catch (e) {
  try {
    process.env.TS_NODE_PROJECT =
      process.env.TS_NODE_PROJECT || path.resolve(__dirname, 'tsconfig.server.json');
    require('ts-node/register');
    require('./server/lib/blogger/media');
    console.log('Successfully imported blogger media (ts)');
  } catch (inner) {
    console.error('Failed to import blogger media', inner);
  }
}
