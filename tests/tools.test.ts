/**
 * Tool tests through a real MCP client (in-memory transport) with a fake ZeroBounce API.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_TOOLS } from '../src/index.js';
import { clearResultCache } from '../src/tools/bulk.js';
import { connect, fakeFetch, json, text } from './helpers.js';

// =============================================================================
// Catalogue rules
// =============================================================================

test('every tool is prefixed, documented, costed and annotated', () => {
  assert.equal(ALL_TOOLS.length, 21);
  const names = new Set<string>();
  for (const tool of ALL_TOOLS) {
    assert.match(tool.name, /^zerobounce_[a-z_]+$/, tool.name);
    assert.ok(!names.has(tool.name), `duplicate ${tool.name}`);
    names.add(tool.name);
    assert.ok(tool.title && tool.description.length > 40, `${tool.name} needs a title and description`);
    assert.ok(tool.cost, `${tool.name} needs a cost`);
    for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) {
      assert.equal(typeof tool.annotations[hint], 'boolean', `${tool.name} missing ${hint}`);
    }
  }
});

test('tools that spend credits are never marked read-only', () => {
  for (const tool of ALL_TOOLS) {
    if (/credit/i.test(tool.cost) && !/^free/i.test(tool.cost)) {
      assert.equal(tool.annotations.readOnlyHint, false, `${tool.name} spends credits`);
    }
  }
  const destructive = ALL_TOOLS.filter(t => t.annotations.destructiveHint).map(t => t.name).sort();
  assert.deepEqual(destructive, ['zerobounce_bulk_delete', 'zerobounce_delete_filter']);
});

test('local file parameters are only exposed in CLI mode', async () => {
  const http = await connect({ allowLocalFiles: false });
  const cli = await connect({ allowLocalFiles: true, transport: 'stdio' });
  const httpTools = (await http.client.listTools()).tools;
  const cliTools = (await cli.client.listTools()).tools;
  const props = (tools: typeof httpTools, name: string) => Object.keys(tools.find(t => t.name === name)!.inputSchema.properties ?? {});
  assert.ok(!props(httpTools, 'zerobounce_bulk_validate').includes('file_path'));
  assert.ok(!props(httpTools, 'zerobounce_bulk_results').includes('save_to_path'));
  assert.ok(props(cliTools, 'zerobounce_bulk_validate').includes('file_path'));
  assert.ok(props(cliTools, 'zerobounce_bulk_results').includes('save_to_path'));
  await http.close();
  await cli.close();
});

test('file_path is rejected over HTTP even if a client sends it anyway', async () => {
  const f = fakeFetch(() => json({ success: true, file_id: 'x' }));
  const { call, close } = await connect({ fetchImpl: f.fetch });
  // Unknown properties are stripped by the schema, so this is treated as "no data provided".
  const result = await call('zerobounce_bulk_validate', { file_path: '/etc/passwd' });
  assert.equal(result.isError, true);
  assert.match(result.text, /emails or csv_content/);
  assert.equal(f.requests.length, 0);
  await close();
});

// =============================================================================
// Behaviour
// =============================================================================

test('hello works without a ZeroBounce key or API call', async () => {
  const f = fakeFetch(() => json({}));
  const { call, close } = await connect({ apiKey: undefined, fetchImpl: f.fetch, region: 'eu' });
  const result = await call('zerobounce_hello');
  assert.equal(result.isError, false);
  assert.match(result.text, /EU \(api-eu\.zerobounce\.net\)/);
  assert.equal(f.requests.length, 0);
  await close();
});

test('missing API key gives a clear tool error', async () => {
  const { call, close } = await connect({ apiKey: undefined });
  const result = await call('zerobounce_get_credits');
  assert.equal(result.isError, true);
  assert.match(result.text, /No ZeroBounce API key/);
  await close();
});

test('validate_email formats a verdict with explanations', async () => {
  const f = fakeFetch(() =>
    json({
      address: 'disposable@example.com',
      status: 'do_not_mail',
      sub_status: 'disposable',
      free_email: false,
      did_you_mean: null,
      domain: 'example.com',
      mx_found: 'true',
      mx_record: 'mx.example.com',
      smtp_provider: 'example',
      processed_at: '2026-10-08 10:00:00.000',
    }),
  );
  const { call, close } = await connect({ fetchImpl: f.fetch });
  const result = await call('zerobounce_validate_email', { email: 'disposable@example.com' });
  assert.equal(result.isError, false);
  assert.match(result.text, /disposable@example\.com: DO NOT SEND/);
  assert.match(result.text, /temporary\/disposable/);
  assert.match(result.text, /MX record:\*\* mx\.example\.com/);

  const raw = await call('zerobounce_validate_email', { email: 'disposable@example.com', response_format: 'json' });
  assert.equal(JSON.parse(raw.text).sub_status, 'disposable');
  await close();
});

test('validate_batch removes duplicates before spending credits', async () => {
  const f = fakeFetch(() =>
    json({
      email_batch: [
        { address: 'a@x.com', status: 'valid', sub_status: '' },
        { address: 'b@x.com', status: 'catch-all', sub_status: '' },
      ],
      errors: [],
    }),
  );
  const { call, close } = await connect({ fetchImpl: f.fetch });
  const result = await call('zerobounce_validate_batch', { emails: ['a@x.com', 'A@x.com', 'b@x.com'] });
  const sent = JSON.parse(f.requests[0].body).email_batch.map((e: { email_address: string }) => e.email_address);
  assert.deepEqual(sent, ['a@x.com', 'b@x.com']);
  assert.match(result.text, /1 duplicate/);
  assert.match(result.text, /\| SAFE \| 1 \|/);
  assert.match(result.text, /\| RISKY \| 1 \|/);
  await close();
});

test('validate_batch enforces the 100-email limit', async () => {
  const { call, close } = await connect({});
  const emails = Array.from({ length: 101 }, (_, i) => `u${i}@x.com`);
  const result = await call('zerobounce_validate_batch', { emails });
  assert.equal(result.isError, true);
  await close();
});

test('find_email needs exactly one of domain or company_name', async () => {
  const f = fakeFetch(() => json({ email: 'jo.smith@acme.com', email_confidence: 'HIGH', domain: 'acme.com', failure_reason: '' }));
  const { call, close } = await connect({ fetchImpl: f.fetch });
  assert.match((await call('zerobounce_find_email', { first_name: 'Jo' })).text, /either domain or company_name/);
  assert.match((await call('zerobounce_find_email', { first_name: 'Jo', domain: 'a.com', company_name: 'A' })).text, /only one/);
  assert.equal(f.requests.length, 0);

  const ok = await call('zerobounce_find_email', { first_name: 'Jo', last_name: 'Smith', domain: 'acme.com' });
  assert.match(ok.text, /\*\*Email:\*\* jo\.smith@acme\.com/);
  assert.match(ok.text, /Confidence:\*\* high/);
  assert.equal(f.requests[0].form?.get('first_name'), 'Jo');
  await close();
});

test('domain_search shows the format and alternatives', async () => {
  const f = fakeFetch(() =>
    json({
      domain: 'acme.com',
      format: 'first.last',
      confidence: 'high',
      failure_reason: '',
      other_domain_formats: [{ format: 'first', confidence: 'medium' }],
    }),
  );
  const { call, close } = await connect({ fetchImpl: f.fetch });
  const result = await call('zerobounce_domain_search', { domain: 'acme.com' });
  assert.match(result.text, /`first\.last`/);
  assert.match(result.text, /\| `first` \| medium \|/);
  await close();
});

test('bulk_validate builds the CSV in memory from an email list', async () => {
  const f = fakeFetch(() => json({ success: true, message: 'File Accepted', file_name: 'list.csv', file_id: 'file-1' }));
  const { call, close } = await connect({ fetchImpl: f.fetch });
  const result = await call('zerobounce_bulk_validate', { emails: ['a@x.com', 'b@x.com'], file_name: 'list' });
  assert.equal(result.isError, false, result.text);
  assert.match(result.text, /file-1/);
  assert.match(result.text, /zerobounce_bulk_status/);
  const form = f.requests[0].multipart!;
  assert.equal(form.get('email_address_column'), '1');
  assert.equal(form.get('has_header_row'), 'true');
  const file = form.get('file') as File;
  assert.equal(file.name, 'list.csv');
  assert.equal(await file.text(), 'email\r\na@x.com\r\nb@x.com\r\n');
  await close();
});

test('bulk uploads validate CSV columns before calling ZeroBounce', async () => {
  const f = fakeFetch(() => json({ success: true, file_id: 'x' }));
  const { call, close } = await connect({ fetchImpl: f.fetch });
  const result = await call('zerobounce_bulk_validate', { csv_content: 'name,email\nJo,jo@x.com\n', email_address_column: 3 });
  assert.equal(result.isError, true);
  assert.match(result.text, /only has 2 column/);
  const both = await call('zerobounce_bulk_validate', { emails: ['a@x.com'], csv_content: 'a@x.com' });
  assert.match(both.text, /only one of/);
  assert.equal(f.requests.length, 0);
  await close();
});

test('bulk_find_emails maps contacts to the right columns', async () => {
  const f = fakeFetch(() => json({ success: true, file_id: 'ef-1' }));
  const { call, close } = await connect({ fetchImpl: f.fetch });
  await call('zerobounce_bulk_find_emails', {
    contacts: [
      { first_name: 'Jo', last_name: 'Smith', domain: 'acme.com' },
      { first_name: 'Al', domain: 'beta.io' },
    ],
  });
  const form = f.requests[0].multipart!;
  assert.equal(form.get('first_name_column'), '1');
  assert.equal(form.get('last_name_column'), '2');
  assert.equal(form.get('domain_column'), '3');
  assert.equal(form.has('middle_name_column'), false);
  assert.equal(await (form.get('file') as File).text(), 'first_name,last_name,domain\r\nJo,Smith,acme.com\r\nAl,,beta.io\r\n');
  await close();
});

test('bulk_results summarises, filters and pages results (downloading once)', async () => {
  clearResultCache();
  const header = '"Email Address","ZB Status","ZB Sub Status","ZB Account","ZB Did You Mean","ZB Free Email"';
  const rows = [
    '"a@x.com","valid","","a","","False"',
    '"b@x.com","invalid","mailbox_not_found","b","","False"',
    '"c@x.com","valid","","c","","True"',
    '"d@x.com","do_not_mail","role_based","d","","False"',
  ];
  const csv = [header, ...rows].join('\r\n');
  const f = fakeFetch(() => new Response(csv, { status: 200, headers: { 'content-type': 'application/octet-stream' } }));
  const { call, close } = await connect({ fetchImpl: f.fetch });

  const summary = await call('zerobounce_bulk_results', { service: 'validation', file_id: 'file-1' });
  assert.match(summary.text, /\*\*Rows:\*\* 4/);
  assert.match(summary.text, /\| valid \| SAFE \| 2 \| 50\.0% \|/);
  assert.match(summary.text, /\| mailbox_not_found \| 1 \|/);

  const page = await call('zerobounce_bulk_results', { service: 'validation', file_id: 'file-1', view: 'rows', filter: 'valid', limit: 1 });
  assert.match(page.text, /Rows 1-1 of 2 matching "valid"/);
  assert.match(page.text, /offset=1/);
  assert.doesNotMatch(page.text, /ZB Account \|/, 'default columns should skip noisy fields');

  const json = await call('zerobounce_bulk_results', { service: 'validation', file_id: 'file-1', view: 'rows', response_format: 'json' });
  const parsed = JSON.parse(json.text);
  assert.equal(parsed.total_rows, 4);
  assert.equal(parsed.rows[1]['ZB Sub Status'], 'mailbox_not_found');

  assert.equal(f.requests.length, 1, 'results should be cached between calls');
  await close();
});

test('bulk_results caches per API key (users never share results)', async () => {
  clearResultCache();
  const csv = '"Email Address","ZB Status"\r\n"a@x.com","valid"';
  const f = fakeFetch(() => new Response(csv, { status: 200, headers: { 'content-type': 'application/octet-stream' } }));
  const userA = await connect({ fetchImpl: f.fetch, apiKey: 'key-user-a-123456' });
  const userB = await connect({ fetchImpl: f.fetch, apiKey: 'key-user-b-123456' });
  await userA.call('zerobounce_bulk_results', { service: 'validation', file_id: 'same-id' });
  await userB.call('zerobounce_bulk_results', { service: 'validation', file_id: 'same-id' });
  assert.equal(f.requests.length, 2);
  await userA.close();
  await userB.close();
});

test('scoring results show an average and distribution', async () => {
  clearResultCache();
  const csv = 'email,ZeroBounceQualityScore\r\na@x.com,10\r\nb@x.com,4\r\nc@x.com,10';
  const f = fakeFetch(() => text(csv, 200, 'application/octet-stream'));
  const { call, close } = await connect({ fetchImpl: f.fetch });
  const result = await call('zerobounce_bulk_results', { service: 'scoring', file_id: 's-1' });
  assert.match(result.text, /Average score:\*\* 8\.0 \/ 10/);
  assert.match(result.text, /\| 10 \| 2 \| 66\.7% \|/);
  await close();
});

test('bulk_status explains what to do next', async () => {
  const f = fakeFetch(
    () => json({ success: true, file_id: 'f1', file_name: 'list.csv', file_status: 'Processing', complete_percentage: '40%' }),
    () => json({ success: true, file_id: 'f1', file_name: 'list.csv', file_status: 'Complete', complete_percentage: '100%' }),
  );
  const { call, close } = await connect({ fetchImpl: f.fetch });
  assert.match((await call('zerobounce_bulk_status', { service: 'validation', file_id: 'f1' })).text, /Still processing/);
  assert.match((await call('zerobounce_bulk_status', { service: 'validation', file_id: 'f1' })).text, /zerobounce_bulk_results/);
  await close();
});

test('evaluate_list checks the 100-address minimum locally and strips headers', async () => {
  const f = fakeFetch(() => json({ file_id: 'le-1', status: 'processing', progress: 0 }, 201));
  const { call, close } = await connect({ fetchImpl: f.fetch });

  const tooFew = await call('zerobounce_evaluate_list', { csv_content: 'email\na@x.com\nb@x.com' });
  assert.equal(tooFew.isError, true);
  assert.match(tooFew.text, /at least 100/);
  assert.equal(f.requests.length, 0);

  const csv = ['email', ...Array.from({ length: 100 }, (_, i) => `u${i}@x.com`)].join('\n');
  const ok = await call('zerobounce_evaluate_list', { csv_content: csv });
  assert.equal(ok.isError, false, ok.text);
  const uploaded = await (f.requests[0].multipart!.get('file') as File).text();
  assert.ok(uploaded.startsWith('u0@x.com'), 'header row should be removed');
  assert.match(ok.text, /le-1/);
  await close();
});

test('ZeroBounce errors become tool errors (isError) with friendly text', async () => {
  const f = fakeFetch(() => json({ error: 'Invalid API Key or your account ran out of credits' }));
  const { call, close } = await connect({ fetchImpl: f.fetch });
  const result = await call('zerobounce_validate_email', { email: 'a@b.com' });
  assert.equal(result.isError, true);
  assert.match(result.text, /^Error: ZeroBounce rejected the API key/);
  await close();
});
