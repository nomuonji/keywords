#!/usr/bin/env node
const path = require('node:path');
require('dotenv').config({ path: '.env' });

let KeywordIdeaClient;
try {
  // Prefer compiled output when available
  ({ KeywordIdeaClient } = require('../dist/server/lib/ads'));
} catch {
  process.env.TS_NODE_PROJECT =
    process.env.TS_NODE_PROJECT || path.resolve(__dirname, '../tsconfig.server.json');
  require('ts-node/register');
  ({ KeywordIdeaClient } = require('../server/lib/ads'));
}

const requiredEnv = [
  'ADS_DEVELOPER_TOKEN',
  'ADS_CLIENT_ID',
  'ADS_CLIENT_SECRET',
  'ADS_REFRESH_TOKEN',
  'ADS_CUSTOMER_ID'
];

const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length) {
  // eslint-disable-next-line no-console
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const client = new KeywordIdeaClient({
  developerToken: process.env.ADS_DEVELOPER_TOKEN,
  clientId: process.env.ADS_CLIENT_ID,
  clientSecret: process.env.ADS_CLIENT_SECRET,
  refreshToken: process.env.ADS_REFRESH_TOKEN,
  customerId: process.env.ADS_CUSTOMER_ID,
  loginCustomerId: process.env.ADS_LOGIN_CUSTOMER_ID
});

(async () => {
  try {
    const ideas = await client.generateKeywordIdeas({
      projectId: 'test',
      seedText: '英会話',
      locale: 'ja',
      locationIds: [2392], // Japan
      languageId: 1005, // Japanese
      maxResults: 10,
      minVolume: 10,
      maxCompetition: 1
    });
    // eslint-disable-next-line no-console
    console.log('Received ideas:', ideas.length);
    ideas.slice(0, 5).forEach((idea, index) => {
      // eslint-disable-next-line no-console
      console.log(`${index + 1}. ${idea.keyword}`, idea.metrics);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to fetch keyword ideas:', error);
    process.exitCode = 1;
  }
})();

