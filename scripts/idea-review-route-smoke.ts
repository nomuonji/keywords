import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import app from '../api/theme-research.js';

process.env.IDEA_REVIEW_ADMIN_TOKEN = 'idea-review-smoke-only-admin-token';
const privateKey = generateKeyPairSync('rsa',{modulusLength:2048})
  .privateKey.export({type:'pkcs8',format:'pem'}).toString();
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  project_id: 'test', client_email: 'test@example.com', private_key: privateKey
});
process.env.KEYWORDS_FIRESTORE_RETRY_ATTEMPTS = '0';

const json = (content: unknown, status = 200) =>
  new Response(JSON.stringify(content), {status, headers: {'content-type':'application/json'}});
const priorFetch = globalThis.fetch;
const fetchedUris: string[] = [];
globalThis.fetch = async (input: any) => {
  const uri = String(input);
  fetchedUris.push(uri);
  if (uri.includes('oauth2.googleapis.com')) return json({access_token:'test-token',expires_in:3600});
  if (uri.includes('firestore.googleapis.com')) return json({documents:[]});
  return priorFetch(input);
};
const url = 'https://example.test/api/theme-research';
const anon = await app.request(url + '?resource=idea-inbox');
assert.equal(anon.status,401,'idea list must not be public');
const session = await app.request(url + '?resource=idea-session');
assert.equal(session.status,200);
assert.equal((await session.json()).authenticated,false);
const crossSite = await app.request(url,{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify({action:'login',password:'idea-review-smoke-only-admin-token'})});
assert.equal(crossSite.status,403);
const bad = await app.request(url,{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({action:'login',password:'incorrect'})});
assert.equal(bad.status,401);
const login = await app.request(url,{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({action:'login',password:'idea-review-smoke-only-admin-token'})});
assert.equal(login.status,200);
const cookie = login.headers.get('set-cookie') || '';
assert.match(cookie,/HttpOnly/);
assert.match(cookie,/SameSite=Strict/);
const inbox = await app.request(url + '?resource=idea-inbox', {headers:{Cookie: cookie.split(';')[0]}});
assert.equal(inbox.status,200);
assert.deepEqual((await inbox.json()).items,[]);
const summary = await app.request(url + '?resource=idea-inbox&summary=1', {headers:{Cookie: cookie.split(';')[0]}});
assert.equal(summary.status,200);
assert.deepEqual((await summary.json()).items,[]);
assert.ok(fetchedUris.some(uri => uri.includes('mask.fieldPaths=title')), 'summary requests field mask');
const unauthDetail = await app.request(url + '?resource=idea-detail&id=idea-1');
assert.equal(unauthDetail.status,401);
const badDetail = await app.request(url + '?resource=idea-detail&id=%3Cbad%3E', {headers:{Cookie: cookie.split(';')[0]}});
assert.equal(badDetail.status,400);
const feedback = await app.request(url + '?resource=idea-feedback', {headers:{Cookie: cookie.split(';')[0]}});
assert.equal(feedback.status,200);
assert.deepEqual((await feedback.json()).events,[]);
const normalTheme = await app.request(url + '?resource=sessions');
assert.notEqual(normalTheme.status,401,'regular theme research route should remain public and unchanged');
console.log('Idea Review route smoke passed');
