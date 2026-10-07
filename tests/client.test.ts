/**
 * ZeroBounceClient tests with a fake fetch (no network).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZeroBounceClient } from '../src/zerobounce/client.js';
import { ZeroBounceError } from '../src/zerobounce/errors.js';
import { fakeFetch, json, text } from './helpers.js';

const KEY = 'zb-secret-key-abcdef';

function client(fetchImpl: typeof fetch, region: 'default' | 'us' | 'eu' = 'default') {
  return new ZeroBounceClient({ apiKey: KEY, region, fetchImpl, retryDelayMs: 0 });
}

test('real-time calls POST a form body so the key is never in the URL', async () => {
  const f = fakeFetch(() => json({ Credits: '2375' }));
  assert.equal(await client(f.fetch).getCredits(), 2375);
  const [req] = f.requests;
  assert.equal(req.method, 'POST');
  assert.equal(req.url, 'https://api.zerobounce.net/v2/getcredits');
  assert.equal(req.form?.get('api_key'), KEY);
  assert.ok(!req.url.includes(KEY));
  assert.match(req.headers['user-agent'], /^mcp-zerobounce\//);
});

test('regions switch the real-time host but bulk stays global', async () => {
  const f = fakeFetch(
    () => json({ address: 'a@b.com', status: 'valid', sub_status: '' }),
    () => json({ success: true, file_id: 'f1', file_status: 'Complete' }),
  );
  const c = client(f.fetch, 'us');
  await c.validate({ email: 'a@b.com' });
  await c.fileStatus('validation', 'f1');
  assert.equal(f.requests[0].url, 'https://api-us.zerobounce.net/v2/validate');
  assert.match(f.requests[1].url, /^https:\/\/bulkapi\.zerobounce\.net\/v2\/filestatus\?/);
});

test('getCredits of -1 is reported as an auth error', async () => {
  const f = fakeFetch(() => json({ Credits: -1 }));
  await assert.rejects(client(f.fetch).getCredits(), (e: ZeroBounceError) => e.kind === 'auth');
});

test('validate passes optional flags as strings and skips empty values', async () => {
  const f = fakeFetch(() => json({ address: 'a@b.com', status: 'valid', sub_status: '' }));
  await client(f.fetch).validate({ email: 'a@b.com', activityData: true, verifyPlus: false, timeout: 10 });
  const form = f.requests[0].form!;
  assert.equal(form.get('activity_data'), 'true');
  assert.equal(form.get('verify_plus'), 'false');
  assert.equal(form.get('timeout'), '10');
  assert.equal(form.has('ip_address'), false);
  assert.equal(form.has('domain_info'), false);
});

test('validatebatch sends JSON and fails the whole batch on an "all" error', async () => {
  const ok = fakeFetch(() => json({ email_batch: [{ address: 'a@b.com', status: 'valid' }], errors: [] }));
  const result = await client(ok.fetch).validateBatch({ emails: [{ email: 'a@b.com' }] });
  assert.equal(result.email_batch.length, 1);
  const body = JSON.parse(ok.requests[0].body);
  assert.equal(body.api_key, KEY);
  assert.deepEqual(body.email_batch, [{ email_address: 'a@b.com', ip_address: null }]);

  const bad = fakeFetch(() =>
    json({ email_batch: [], errors: [{ error: 'Invalid API Key or your account ran out of credits', email_address: 'all' }] }),
  );
  await assert.rejects(client(bad.fetch).validateBatch({ emails: [{ email: 'a@b.com' }] }), (e: ZeroBounceError) => e.kind === 'auth');
});

test('guessformat treats a bare Message as an error, but not a real result', async () => {
  const err = fakeFetch(() => json({ Message: 'Invalid API key or your account ran out of credits' }));
  await assert.rejects(client(err.fetch).guessFormat({ domain: 'acme.com' }), (e: ZeroBounceError) => e.kind === 'auth');

  const ok = fakeFetch(() => json({ domain: 'acme.com', format: 'first.last', confidence: 'high', failure_reason: '' }));
  const result = await client(ok.fetch).guessFormat({ domain: 'acme.com' });
  assert.equal(result.format, 'first.last');
});

test('filters/add success Message is not treated as an error', async () => {
  const f = fakeFetch(() => json({ Message: 'Filter successfully added' }));
  assert.equal(await client(f.fetch).addFilter({ rule: 'allow', target: 'domain', value: 'acme.com' }), 'Filter successfully added');
  assert.equal(f.requests[0].form?.get('rule'), 'allow');
});

test('429 is not retried and maps to rate_limited', async () => {
  const f = fakeFetch(() => json({ error: 'Too many requests' }, 429));
  await assert.rejects(client(f.fetch).getCredits(), (e: ZeroBounceError) => e.kind === 'rate_limited');
  assert.equal(f.requests.length, 1);
});

test('free read-only calls retry once on 5xx', async () => {
  const f = fakeFetch(() => text('bad gateway', 520), () => json({ Credits: 10 }));
  assert.equal(await client(f.fetch).getCredits(), 10);
  assert.equal(f.requests.length, 2);
});

test('credit-spending calls are not retried', async () => {
  const f = fakeFetch(() => text('oops', 500), () => json({ address: 'a@b.com', status: 'valid' }));
  await assert.rejects(client(f.fetch).validate({ email: 'a@b.com' }), (e: ZeroBounceError) => e.kind === 'server');
  assert.equal(f.requests.length, 1);
});

test('a Cloudflare HTML 403 becomes a firewall error without echoing HTML', async () => {
  const f = fakeFetch(() => text('<!DOCTYPE html><html>Attention Required! | Cloudflare</html>', 403, 'text/html'));
  await assert.rejects(client(f.fetch).getCredits(), (e: ZeroBounceError) => e.kind === 'firewall' && !e.message.includes('Cloudflare'));
});

test('getfile returns CSV, and JSON-with-200 errors are detected', async () => {
  const csv = '"Email Address","ZB Status"\n"a@b.com","valid"\n';
  const ok = fakeFetch(() => new Response(csv, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="results.csv"' } }));
  const file = await client(ok.fetch).getFile('validation', 'abc-123', { downloadType: 'combined' });
  assert.equal(file.csv, csv);
  assert.equal(file.fileName, 'results.csv');
  const url = new URL(ok.requests[0].url);
  assert.equal(url.searchParams.get('download_type'), 'combined');
  assert.equal(url.searchParams.get('file_id'), 'abc-123');

  const bad = fakeFetch(() => json({ success: false, message: 'File is not ready' }));
  await assert.rejects(client(bad.fetch).getFile('scoring', 'abc'), (e: ZeroBounceError) => /not ready/.test(e.message));
});

test('getfile only sends download_type/activity_data for validation', async () => {
  const f = fakeFetch(() => text('email,score\na@b.com,9\n', 200, 'application/octet-stream'));
  await client(f.fetch).getFile('scoring', 'abc', { downloadType: 'combined', activityData: true });
  const url = new URL(f.requests[0].url);
  assert.equal(url.pathname, '/v2/scoring/getfile');
  assert.equal(url.searchParams.has('download_type'), false);
  assert.equal(url.searchParams.has('activity_data'), false);
});

test('sendFile uploads multipart with the CSV and fields', async () => {
  const f = fakeFetch(() => json({ success: true, message: 'File Accepted', file_name: 'x.csv', file_id: 'f-1' }));
  const result = await client(f.fetch).sendFile('email_finder', 'first_name,domain\nJo,acme.com\n', 'x.csv', {
    domain_column: 2,
    first_name_column: 1,
    has_header_row: true,
  });
  assert.equal(result.file_id, 'f-1');
  const req = f.requests[0];
  assert.equal(req.url, 'https://bulkapi.zerobounce.net/email-finder/sendfile');
  const form = req.multipart!;
  assert.equal(form.get('api_key'), KEY);
  assert.equal(form.get('domain_column'), '2');
  assert.equal(form.get('has_header_row'), 'true');
  const file = form.get('file') as File;
  assert.equal(file.name, 'x.csv');
  assert.equal(await file.text(), 'first_name,domain\nJo,acme.com\n');
});

test('file IDs are validated before being put in a URL', async () => {
  const f = fakeFetch(() => json({}));
  await assert.rejects(client(f.fetch).evaluateListStatus('../../etc/passwd'), (e: ZeroBounceError) => e.kind === 'bad_request');
  assert.equal(f.requests.length, 0);
});

test('list evaluator uses the trailing-slash paths', async () => {
  const f = fakeFetch(
    () => json({ file_id: 'le-1', status: 'processing' }, 201),
    () => json({ file_id: 'le-1', status: 'finished', invalid_percentage: 7 }),
  );
  const c = client(f.fetch);
  await c.evaluateList('a@b.com\n', 'list.csv', 1);
  await c.evaluateListStatus('le-1');
  assert.equal(f.requests[0].url, 'https://bulkapi.zerobounce.net/v2/listevaluator/');
  assert.match(f.requests[1].url, /^https:\/\/bulkapi\.zerobounce\.net\/v2\/listevaluator\/le-1\/\?api_key=/);
});

test('getfile enforces the size cap even without Content-Length (chunked)', async () => {
  const chunk = new TextEncoder().encode('a@b.com,valid\n'.repeat(1000)); // ~14 KB
  const f = fakeFetch(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (let i = 0; i < 10; i++) controller.enqueue(chunk);
            controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'application/octet-stream' } },
      ),
  );
  const c = new ZeroBounceClient({ apiKey: KEY, fetchImpl: f.fetch, retryDelayMs: 0, maxResultBytes: 50_000 });
  await assert.rejects(c.getFile('validation', 'big-file'), (e: ZeroBounceError) => /too large/.test(e.message));
});

test('a timeout while reading the body is reported as a timeout', async () => {
  const f = fakeFetch(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial'));
            controller.error(new DOMException('The operation timed out.', 'TimeoutError'));
          },
        }),
        { status: 200, headers: { 'content-type': 'application/octet-stream' } },
      ),
  );
  await assert.rejects(client(f.fetch).getFile('validation', 'slow-file'), (e: ZeroBounceError) => e.kind === 'timeout');
});

test('deleting a filter that does not exist is an error, not a success', async () => {
  const f = fakeFetch(() => json({ Message: 'Filter does not exist' }));
  await assert.rejects(
    client(f.fetch).deleteFilter({ rule: 'allow', target: 'email', value: 'x@y.com' }),
    (e: ZeroBounceError) => e.kind === 'not_found',
  );
});

test('network failures never leak the API key', async () => {
  const f = fakeFetch(() => {
    throw new Error(`connect ECONNREFUSED while sending ${KEY}`);
  });
  await assert.rejects(client(f.fetch).validate({ email: 'a@b.com' }), (e: ZeroBounceError) => e.kind === 'network' && !e.message.includes(KEY));
});
