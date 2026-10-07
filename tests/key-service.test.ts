/**
 * Key-service client tests: status mapping, caching, de-duplication.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyServiceClient, KEY_SERVICE_SERVER_ID } from '../src/utils/key-service.js';
import { fakeFetch, json, text } from './helpers.js';

const USER_KEY = 'usr_0123456789abcdef0123456789abcdef';

function service(fetchImpl: typeof fetch) {
  return new KeyServiceClient({ url: 'http://key-service/internal/resolve', token: 'server-token', fetchImpl });
}

test('a valid key resolves to apiKey + region, sending bearer token and server_id', async () => {
  const f = fakeFetch(() => json({ valid: true, credentials: { apiKey: 'zb-key', region: 'eu' }, label: 'x', connector_id: 'zerobounce' }));
  const ks = service(f.fetch);
  const result = await ks.resolve(USER_KEY);
  assert.deepEqual(result, { ok: true, credentials: { apiKey: 'zb-key', region: 'eu' } });
  assert.equal(f.requests[0].headers.authorization, 'Bearer server-token');
  assert.deepEqual(JSON.parse(f.requests[0].body), { key: USER_KEY, server_id: KEY_SERVICE_SERVER_ID });
  ks.dispose();
});

test('401 from the key service means the user key is invalid', async () => {
  const f = fakeFetch(() => json({ valid: false, error: 'Invalid, revoked, or suspended API key, or server not authorized' }, 401));
  const ks = service(f.fetch);
  assert.deepEqual(await ks.resolve(USER_KEY), { ok: false, reason: 'invalid_key' });
  ks.dispose();
});

test('403 from the key service is OUR misconfiguration, not an invalid user key', async () => {
  const f = fakeFetch(() => json({ valid: false, error: 'Unauthorized' }, 403));
  const ks = service(f.fetch);
  assert.deepEqual(await ks.resolve(USER_KEY), { ok: false, reason: 'service_unavailable' });
  ks.dispose();
});

test('5xx, network errors and bad responses are handled', async () => {
  const down = service(fakeFetch(() => json({ valid: false, error: 'Key service unavailable' }, 503)).fetch);
  assert.deepEqual(await down.resolve(USER_KEY), { ok: false, reason: 'service_unavailable' });
  down.dispose();

  const offline = service(
    fakeFetch(() => {
      throw new TypeError('fetch failed');
    }).fetch,
  );
  assert.deepEqual(await offline.resolve(USER_KEY), { ok: false, reason: 'service_unavailable' });
  offline.dispose();

  const html = service(fakeFetch(() => text('<html>proxy error</html>', 200, 'text/html')).fetch);
  assert.deepEqual(await html.resolve(USER_KEY), { ok: false, reason: 'malformed_response' });
  html.dispose();

  const noKey = service(fakeFetch(() => json({ valid: true, credentials: { somethingElse: 'x' } })).fetch);
  assert.deepEqual(await noKey.resolve(USER_KEY), { ok: false, reason: 'malformed_response' });
  noKey.dispose();
});

test('successful lookups are cached and concurrent lookups share one request', async () => {
  const f = fakeFetch(async () => {
    await new Promise(r => setTimeout(r, 20));
    return json({ valid: true, credentials: { apiKey: 'zb-key' } });
  });
  const ks = service(f.fetch);
  const [a, b] = await Promise.all([ks.resolve(USER_KEY), ks.resolve(USER_KEY)]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(f.requests.length, 1);
  await ks.resolve(USER_KEY);
  assert.equal(f.requests.length, 1, 'third call should be served from cache');
  ks.dispose();
});

test('a 404 means a misconfigured KEY_SERVICE_URL, not an invalid user key', async () => {
  const ks = service(fakeFetch(() => text('Not Found', 404, 'text/html')).fetch);
  assert.deepEqual(await ks.resolve(USER_KEY), { ok: false, reason: 'service_unavailable' });
  ks.dispose();
});

test('service failures are not cached', async () => {
  const f = fakeFetch(() => json({ valid: false, error: 'Key service unavailable' }, 503), () => json({ valid: true, credentials: { apiKey: 'zb-key' } }));
  const ks = service(f.fetch);
  assert.equal((await ks.resolve(USER_KEY)).ok, false);
  assert.equal((await ks.resolve(USER_KEY)).ok, true);
  ks.dispose();
});

test('rejected keys are remembered briefly (no repeat calls to the key service)', async () => {
  const f = fakeFetch(() => json({ valid: false, error: 'Invalid' }, 401));
  const ks = service(f.fetch);
  assert.deepEqual(await ks.resolve(USER_KEY), { ok: false, reason: 'invalid_key' });
  assert.deepEqual(await ks.resolve(USER_KEY), { ok: false, reason: 'invalid_key' });
  assert.equal(f.requests.length, 1);
  ks.dispose();
});
