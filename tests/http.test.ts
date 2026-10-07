/**
 * HTTP integration tests: starts the real http-server with a fake key service
 * and checks every auth path. No ZeroBounce calls are made (only tools/list and
 * zerobounce_hello are used).
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const VALID_USER_KEY = 'usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const REVOKED_USER_KEY = 'usr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const BAD_REGION_KEY = 'usr_cccccccccccccccccccccccccccccccc';
const MCP_API_KEY = 'test-mcp-api-key';
const SERVER_TOKEN = 'internal-token';

let keyService: http.Server;
let mcp: ChildProcess;
let baseUrl = '';
let keyServiceCalls = 0;

before(async () => {
  // Fake mcp-key-service implementing the real /internal/resolve contract.
  keyService = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      keyServiceCalls++;
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization !== `Bearer ${SERVER_TOKEN}`) {
        res.statusCode = 403;
        res.end(JSON.stringify({ valid: false, error: 'Unauthorized' }));
        return;
      }
      const { key, server_id } = JSON.parse(body);
      assert.equal(server_id, 'zerobounce');
      if (key === VALID_USER_KEY) {
        res.end(JSON.stringify({ valid: true, credentials: { apiKey: 'zb-hosted-key', region: 'us' } }));
      } else if (key === BAD_REGION_KEY) {
        res.end(JSON.stringify({ valid: true, credentials: { apiKey: 'zb-hosted-key', region: 'mars' } }));
      } else {
        res.statusCode = 401;
        res.end(JSON.stringify({ valid: false, error: 'Invalid, revoked, or suspended API key, or server not authorized' }));
      }
    });
  });
  await new Promise<void>(resolve => keyService.listen(0, '127.0.0.1', resolve));
  const ksPort = (keyService.address() as AddressInfo).port;

  const port = 20000 + Math.floor(Math.random() * 20000);
  baseUrl = `http://127.0.0.1:${port}`;
  mcp = spawn(process.execPath, ['--import', 'tsx', path.join('src', 'http-server.ts')], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      MCP_API_KEY,
      KEY_SERVICE_URL: `http://127.0.0.1:${ksPort}/internal/resolve`,
      KEY_SERVICE_TOKEN: SERVER_TOKEN,
      ANALYTICS_DIR: mkdtempSync(path.join(tmpdir(), 'zb-analytics-')),
      PUBLIC_BASE_PATH: '/zerobounce',
      ZEROBOUNCE_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Wait for /health.
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('http-server did not start');
});

after(async () => {
  mcp?.kill();
  await new Promise<void>(resolve => keyService.close(() => resolve()));
});

function rpc(method: string, params: Record<string, unknown> = {}) {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
}

async function post(urlPath: string, body: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body,
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text };
}

test('health, root and server card are public', async () => {
  const health = await (await fetch(`${baseUrl}/health`)).json();
  assert.equal(health.status, 'healthy');
  const card = await (await fetch(`${baseUrl}/.well-known/mcp/server-card.json`)).json();
  assert.equal(card.transport.endpoint, '/zerobounce/mcp');
  assert.equal(card.tools.length, 21);
  const root = await (await fetch(`${baseUrl}/`)).json();
  assert.equal(root.endpoints.mcp, '/zerobounce/mcp/{usr_key}');
});

test('hosted path key: tools/list works and region comes from the key service', async () => {
  const list = await post(`/mcp/${VALID_USER_KEY}`, rpc('tools/list'));
  assert.equal(list.status, 200, list.text);
  assert.equal(list.json.result.tools.length, 21);
  // No local-file parameters over HTTP.
  const bulk = list.json.result.tools.find((t: { name: string }) => t.name === 'zerobounce_bulk_validate');
  assert.ok(!('file_path' in bulk.inputSchema.properties));

  const hello = await post(`/mcp/${VALID_USER_KEY}`, rpc('tools/call', { name: 'zerobounce_hello', arguments: {} }));
  assert.match(hello.json.result.content[0].text, /hosted \(mcp-key-service\)/);
  assert.match(hello.json.result.content[0].text, /US \(api-us/);
});

test('hosted query key works too', async () => {
  const res = await post(`/mcp?api_key=${VALID_USER_KEY}`, rpc('tools/list'));
  assert.equal(res.status, 200);
});

test('hosted key in a header (Bearer or X-API-Key) works and keeps it out of the URL', async () => {
  const bearer = await post('/mcp', rpc('tools/list'), { Authorization: `Bearer ${VALID_USER_KEY}` });
  assert.equal(bearer.status, 200, bearer.text);
  const header = await post('/mcp', rpc('tools/list'), { 'X-API-Key': VALID_USER_KEY });
  assert.equal(header.status, 200, header.text);
  const revoked = await post('/mcp', rpc('tools/list'), { Authorization: `Bearer ${REVOKED_USER_KEY}` });
  assert.equal(revoked.status, 403);
});

test('a revoked key is a 403 with a helpful message', async () => {
  const res = await post(`/mcp/${REVOKED_USER_KEY}`, rpc('tools/list'));
  assert.equal(res.status, 403);
  assert.equal(res.json.error.data.reason, 'invalid_key');
  assert.match(res.json.error.message, /mcpkeys\.techmavie\.digital/);
});

test('an invalid region saved in the portal is reported clearly', async () => {
  const res = await post(`/mcp/${BAD_REGION_KEY}`, rpc('tools/list'));
  assert.equal(res.status, 400);
  assert.equal(res.json.error.data.reason, 'invalid_region');
});

test('raw ZeroBounce keys in the URL are refused (they would end up in logs)', async () => {
  const before = keyServiceCalls;
  const res = await post('/mcp?apiKey=raw-zerobounce-key', rpc('tools/list'));
  assert.equal(res.status, 400);
  assert.equal(res.json.error.data.reason, 'raw_key_not_supported');
  assert.equal(keyServiceCalls, before);
});

test('a non-usr key in the path is refused without calling the key service', async () => {
  const before = keyServiceCalls;
  const res = await post('/mcp/not-a-user-key', rpc('tools/list'));
  assert.equal(res.status, 401);
  assert.equal(keyServiceCalls, before);
});

test('no credentials → 401 with instructions', async () => {
  const res = await post('/mcp', rpc('tools/list'));
  assert.equal(res.status, 401);
  assert.equal(res.json.error.data.reason, 'missing_auth');
});

test('self-hosted mode requires the right MCP_API_KEY and a ZeroBounce key header', async () => {
  const wrong = await post('/mcp', rpc('tools/list'), { 'X-API-Key': 'nope', 'X-ZeroBounce-Api-Key': 'zb' });
  assert.equal(wrong.status, 401);

  const noZbKey = await post('/mcp', rpc('tools/list'), { 'X-API-Key': MCP_API_KEY });
  assert.equal(noZbKey.status, 400);
  assert.equal(noZbKey.json.error.data.reason, 'missing_config');

  const badRegion = await post('/mcp', rpc('tools/list'), { 'X-API-Key': MCP_API_KEY, 'X-ZeroBounce-Api-Key': 'zb', 'X-ZeroBounce-Region': 'mars' });
  assert.equal(badRegion.status, 400);

  const ok = await post('/mcp', rpc('tools/call', { name: 'zerobounce_hello', arguments: {} }), {
    'X-API-Key': MCP_API_KEY,
    'X-ZeroBounce-Api-Key': 'zb',
    'X-ZeroBounce-Region': 'eu',
  });
  assert.equal(ok.status, 200, ok.text);
  assert.match(ok.json.result.content[0].text, /self-hosted/);
  assert.match(ok.json.result.content[0].text, /EU \(api-eu/);
});

test('clients that send a minimal Accept header still work', async () => {
  const res = await post(`/mcp/${VALID_USER_KEY}`, rpc('tools/list'), { accept: 'application/json' });
  assert.equal(res.status, 200, res.text);
});

test('GET and DELETE on /mcp return 405 (stateless server)', async () => {
  const get = await fetch(`${baseUrl}/mcp/${VALID_USER_KEY}`);
  assert.equal(get.status, 405);
  const del = await fetch(`${baseUrl}/mcp`, { method: 'DELETE' });
  assert.equal(del.status, 405);
});

test('analytics needs the MCP_API_KEY and never contains user keys', async () => {
  // Express routes are case-insensitive, so mixed-case paths must be normalised too,
  // and unknown paths (scanners, typos) must not be recorded verbatim.
  const upper = await post(`/MCP/${VALID_USER_KEY}`, rpc('tools/list'));
  assert.equal(upper.status, 200, upper.text);
  await fetch(`${baseUrl}/sse/usr_typo_key_should_not_be_stored`);
  await fetch(`${baseUrl}/wp-login.php`);

  assert.equal((await fetch(`${baseUrl}/analytics`)).status, 401);
  const res = await fetch(`${baseUrl}/analytics`, { headers: { 'X-API-Key': MCP_API_KEY } });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(!body.includes('usr_'), 'analytics must not contain usr_ keys');
  assert.ok(!body.includes('wp-login'), 'unknown paths must not be stored verbatim');
  assert.ok(body.includes('/mcp/:userKey'));
  assert.ok(body.includes('(other)'));
  assert.equal((await fetch(`${baseUrl}/analytics/dashboard`)).status, 200);
});

test('OAuth discovery and unknown routes return JSON 404s', async () => {
  const oauth = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/zerobounce/mcp`);
  assert.equal(oauth.status, 404);
  assert.equal((await oauth.json()).error, 'oauth_metadata_not_supported');
  const unknown = await fetch(`${baseUrl}/nope`);
  assert.equal(unknown.status, 404);
});

test('invalid JSON gets a JSON-RPC parse error', async () => {
  const res = await post(`/mcp/${VALID_USER_KEY}`, '{not json');
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, -32700);
});
