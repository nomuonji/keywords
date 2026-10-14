// Independent, evidence-first market observation. No LLM-selected categories or sales estimates.
// Output: derived category/rank observations only; no Rakuten product text, price or image cache.
// Used by .github/workflows/market-discovery.yml. Node 22+, no third-party dependencies.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const BASE = process.env.MARKET_DISCOVERY_API || 'https://api-three-gilt-37.vercel.app/api/affiliate';
const LIMIT = 10;
const WAIT_MS = 1250;
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const previousPath = process.argv.find(x => x.startsWith('--previous='))?.split('=').slice(1).join('=');
const outputPath = process.argv.find(x => x.startsWith('--output='))?.split('=').slice(1).join('=');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const integer = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0;

async function get(action, genreId) {
  const url = new URL(BASE);
  url.searchParams.set('network', 'rakuten-ichiba');
  url.searchParams.set('action', action);
  url.searchParams.set('genreId', String(genreId));
  if (action === 'ranking') url.searchParams.set('count', '15');
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  if (response.status === 404 || response.status === 502) {
    const data = await response.json().catch(() => ({}));
    // A missing category is expected; an upstream authentication or quota error is not.
    if (response.status === 502 && Number(data.upstreamStatus) !== 404) throw new Error('Rakuten upstream HTTP ' + (data.upstreamStatus || 502));
    return null;
  }
  if (!response.ok) throw new Error(action + ' ' + genreId + ': HTTP ' + response.status);
  return await response.json();
}
async function main() {
  let old = {};
  if (previousPath) {
    try { old = JSON.parse(await readFile(previousPath, 'utf8')); } catch { /* first run */ }
  }
  const retained = (Array.isArray(old.observations) ? old.observations : []).filter(entry => {
    const delta = (Date.parse(today + 'T00:00:00Z') - Date.parse(entry.date + 'T00:00:00Z')) / 86400000;
    return Number.isFinite(delta) && delta >= 0 && delta < 90 && entry.date !== today;
  });
  const roots = await get('genres', '0');
  const categories = (roots?.children || []).filter(x => integer(x.genreId) && Number(x.genreId) > 0)
    .map(x => ({ genreId: String(x.genreId), name: String(x.name || '') }));
  if (categories.length < 10) throw new Error('Rakuten root genres unavailable; no observations were saved');
  const byRoot = id => retained.filter(row => row.rootGenreId === id).length;
  const sorted = [...categories].sort((a, b) => byRoot(a.genreId) - byRoot(b.genreId) ||
    hash(today + ':' + a.genreId).localeCompare(hash(today + ':' + b.genreId)));
  const picked = sorted.slice(0, 6);
  const unused = sorted.filter(x => !picked.includes(x));
  unused.sort((a, b) => (retained.filter(x => x.rootGenreId === a.genreId).at(-1)?.date || '').localeCompare(
    retained.filter(x => x.rootGenreId === b.genreId).at(-1)?.date || '') || hash(today + a.genreId).localeCompare(hash(today + b.genreId)));
  picked.push(...unused.slice(0, 2));
  const repeat = [...retained].reverse().filter(row => !picked.some(x => x.genreId === row.rootGenreId))
    .filter((row, i, all) => all.findIndex(x => x.genreId === row.genreId) === i)
    .slice(0, 2);
  const selections = picked.map(x => ({ root: x, direct: null }))
    .concat(repeat.map(x => ({ root: { genreId: x.rootGenreId, name: x.rootName }, direct: { genreId: x.genreId, name: x.genreName } })));
  while (selections.length < LIMIT && unused.length) {
    const root = unused.shift();
    if (!selections.some(s => s.root.genreId === root.genreId)) selections.push({ root, direct: null });
  }
  const observations = [];
  const errors = [];
  for (const selection of selections.slice(0, LIMIT)) {
    try {
      let chosen = selection.direct;
      if (!chosen) {
        await sleep(WAIT_MS);
        const tree = await get('genres', selection.root.genreId);
        const children = (tree?.children || []).filter(x => integer(x.genreId) && Number(x.genreId) > 0);
        const options = children.length ? children : [selection.root];
        // Pick least-observed subcategory with a date-specific deterministic tie break.
        chosen = [...options].sort((a, b) =>
          retained.filter(row => row.genreId === String(a.genreId)).length - retained.filter(row => row.genreId === String(b.genreId)).length ||
          hash(today + ':' + a.genreId).localeCompare(hash(today + ':' + b.genreId)))[0];
      }
      await sleep(WAIT_MS);
      let rank = null;
      try {
        rank = await get('ranking', chosen.genreId);
      } catch (e) {
        // Individual subgenres may not have ranking data; a malformed ID may be rejected.
        if (!/upstream HTTP 400/.test(String(e))) throw e;
        errors.push({ genreId: String(chosen.genreId), reason: 'unsupported_subgenre' });
      }
      if (!rank?.items?.length && String(chosen.genreId) !== selection.root.genreId) {
        await sleep(WAIT_MS);
        rank = await get('ranking', selection.root.genreId);
        if (rank?.items?.length) chosen = selection.root;
      }
      if (!rank?.items?.length) {
        errors.push({ genreId: String(chosen.genreId), reason: 'no_ranking' });
        continue;
      }
      const preceding = [...retained].reverse().find(row => row.genreId === String(chosen.genreId));
      const priorCodes = new Set((preceding?.items || []).map(x => x.itemCode));
      const items = rank.items.filter(x => typeof x.itemCode === 'string' && x.itemCode.length < 161 && Number.isInteger(x.rank) && x.rank > 0)
        .map(x => ({ itemCode: x.itemCode, rank: x.rank }));
      const overlap = items.filter(x => priorCodes.has(x.itemCode)).length;
      observations.push({
        date: today, rootGenreId: String(selection.root.genreId), rootName: selection.root.name,
        genreId: String(chosen.genreId), genreName: String(chosen.name || selection.root.name),
        selection: selection.direct ? 'revisit' : 'stratified',
        source: 'rakuten_ichiba_ranking', rankingUpdatedAt: rank.lastBuildDate || null,
        items, comparison: preceding ? { previousDate: preceding.date, sameItemCount: overlap, denominator: items.length } : null,
      });
    } catch (e) {
      errors.push({ genreId: String(selection.direct?.genreId ?? selection.root.genreId), reason: String(e.message || e).slice(0, 160) });
      if (/HTTP 429|HTTP 401|HTTP 403|upstream HTTP 429/.test(String(e))) break;
    }
  }
  if (observations.length === 0) throw new Error('No successful category rankings; refusing to replace previous observations: ' + JSON.stringify(errors));
  const next = {
    schemaVersion: 1, date: today, generatedAt: new Date().toISOString(),
    method: { stratified: 6, underobserved: 2, revisit: 2, rankCount: 15, daysRetained: 90, source: 'rakuten_ichiba_ranking' },
    interpretation: 'Category rank is not sales units or evidence of an affiliate conversion. No buyer motivations are inferred from rank alone.',
    coverage: { rootGenreCount: categories.length, sampledToday: observations.length, historicObservations: retained.length + observations.length },
    warnings: errors, observations: [...retained, ...observations],
  };
  if (outputPath) await writeFile(outputPath, JSON.stringify(next, null, 2) + '\n');
  else process.stdout.write(JSON.stringify(next, null, 2) + '\n');
  process.stderr.write('market discovery ' + today + ': ' + observations.length + ' genres, ' + errors.length + ' warnings\n');
}
main().catch(error => { console.error('market discovery failed:', error.message || error); process.exitCode = 1; });
