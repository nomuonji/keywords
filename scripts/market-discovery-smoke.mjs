import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'discovery-'));
const recent = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const stale = '2025-01-01';
const previous = join(dir, 'previous.json'), output = join(dir, 'latest.json');
await writeFile(previous, JSON.stringify({ observations: [
  { date: stale, rootGenreId: '100', genreId: '100', items: [{ itemCode: 'stale:item', rank: 1 }] },
  { date: recent, rootGenreId: '100', genreId: '100', items: [{ itemCode: 'shop:item1', rank: 1 }] }
] }));
const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const id = url.searchParams.get('genreId');
  const action = url.searchParams.get('action');
  res.setHeader('content-type', 'application/json');
  if (action === 'genres') {
    const children = id === '0' ? Array.from({ length: 16 }, (_, n) => ({
      genreId: String(100 + n), name: 'カテゴリ' + n
    })) : [];
    res.end(JSON.stringify({ children }));
  } else if (action === 'ranking') {
    res.end(JSON.stringify({ lastBuildDate: '2026-10-14', items: [
      { rank: 1, itemCode: 'shop:item1', itemName: 'not persisted', itemUrl: 'https://item.rakuten.co.jp/x/' },
      { rank: 2, itemCode: 'shop:item2', itemName: 'not persisted', itemUrl: 'https://item.rakuten.co.jp/y/' },
    ] }));
  } else { res.writeHead(400); res.end('{}'); }
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  // A nonblocking child is needed because the mock server shares the event loop.
  const child = (await import('node:child_process')).spawn(process.execPath, [
    'scripts/market-discovery.mjs', '--previous=' + previous, '--output=' + output,
  ], { env: { ...process.env, MARKET_DISCOVERY_API: 'http://127.0.0.1:' + port + '/affiliate' }, stdio: 'pipe' });
  const status = await new Promise(resolve => child.on('close', resolve));
  assert.equal(status, 0, 'discovery process succeeds with official-shaped responses');
  const report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.coverage.rootGenreCount, 16);
  assert.equal(report.coverage.sampledToday, 10);
  assert.ok(!report.observations.some(row => row.date === stale), 'expired observations pruned');
  assert.ok(!JSON.stringify(report).includes('not persisted'), 'no product text stored');
  assert.ok(report.observations.every(row => row.items.every(item => item.itemCode && Number.isInteger(item.rank))));
  console.log('market discovery smoke ok');
} finally {
  server.close();
  await rm(dir, { recursive: true, force: true });
}
