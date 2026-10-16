import assert from 'node:assert/strict';
import { dispatchSeoDelivery } from '../packages/commands/src/seo-delivery-dispatch.js';

const prior = process.env.SEO_DELIVERY_DISPATCH_TOKEN;
const originalFetch = globalThis.fetch;
try {
  delete process.env.SEO_DELIVERY_DISPATCH_TOKEN;
  globalThis.fetch = (async () => { throw Error('No request expected without token'); }) as typeof fetch;
  await dispatchSeoDelivery('task_1', 2);

  process.env.SEO_DELIVERY_DISPATCH_TOKEN = 'test-secret';
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls += 1;
    assert.equal(url, 'https://api.github.com/repos/nomuonji/keywords/dispatches');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      event_type: 'seo_push_pending',
      client_payload: { task_id: 'task_1', revision: 2 }
    });
    return { status: 204 } as Response;
  }) as typeof fetch;
  await dispatchSeoDelivery('task_1', 2);
  assert.equal(calls, 1);

  globalThis.fetch = (async () => ({ status: 503 }) as Response) as typeof fetch;
  await dispatchSeoDelivery('task_1', 3); // durable save remains authoritative
  assert.rejects(dispatchSeoDelivery('bad/task', 4), /Invalid SEO delivery/);
} finally {
  globalThis.fetch = originalFetch;
  if (prior === undefined) delete process.env.SEO_DELIVERY_DISPATCH_TOKEN;
  else process.env.SEO_DELIVERY_DISPATCH_TOKEN = prior;
}
console.log('SEO delivery dispatch smoke passed');
