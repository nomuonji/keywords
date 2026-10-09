import assert from 'node:assert/strict';
import { seoDeliveryMergePayload } from '../packages/commands/src/seo-delivery-merge.js';

const sample={id:'task-123',title:'[CF-Pages-Skip] Fix real content',siteId:'wiki-shikaku-wiki'};
for(const method of ['squash','merge'] as const){
  const payload=seoDeliveryMergePayload(sample,'abc123',method);
  assert.equal(payload.sha,'abc123');
  assert.equal(payload.merge_method,method);
  assert.match(payload.commit_title,/Fix real content/);
  assert.equal(payload.commit_message.includes('task-123'),true);
  assert.equal(JSON.stringify(payload).includes('[CF-Pages-Skip]'),false);
}
assert.throws(()=>seoDeliveryMergePayload(sample,'abc123','rebase'),/requires a merge\/squash method/);
console.log('seo-delivery merge smoke passed: explicit skip-free main commit, traceable task, rebase fails closed');
