import { siteIndexationInspect, siteIndexationList, siteIndexationSummary } from '../packages/commands/src/site-indexation.js';

async function main() {
  const siteId = 'wiki-shikaku-wiki';
  const url = 'https://shikaku.antonbase.com/';
  const before = await siteIndexationSummary({ siteId });
  console.log('INDEXATION_BEFORE', JSON.stringify(before));
  const inspected = await siteIndexationInspect({ siteId, urls: [url], limit: 1 });
  console.log('INDEXATION_INSPECT', JSON.stringify(inspected));
  const after = await siteIndexationSummary({ siteId });
  console.log('INDEXATION_AFTER', JSON.stringify(after));
  const listed = await siteIndexationList({ siteId, limit: 5 });
  console.log('INDEXATION_LIST', JSON.stringify(listed));
}
main().catch(error => {
  console.error(error);
  process.exit(1);
});
