const path = require('path');
const fs = require('fs');
try {
  require('dotenv').config({ path: path.resolve('/mnt/d/youph/Project/keywords/.env') });
} catch (error) {
  console.warn('dotenv load failed', error);
}
const { GoogleGenerativeAI } = require('@google/generative-ai');
(async () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY missing');
    process.exit(1);
  }
  const client = new GoogleGenerativeAI(apiKey);
  const keyword = process.argv[2] ?? 'test keyword';
  const model = 'models/text-embedding-004';
  try {
    const result = await client.getGenerativeModel({ model }).embedContent({
      content: { parts: [{ text: keyword }] }
    });
    console.log('embedding length', result.embedding.values.length);
  } catch (error) {
    console.error('error', error?.message);
    if (error?.response) {
      console.error('response', await error.response.text());
    }
  }
})();
