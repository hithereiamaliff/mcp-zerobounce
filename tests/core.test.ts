/**
 * Unit tests: error normalisation, regions, CSV, statuses.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorFromApiMessage, errorFromHttpStatus, extractApiError, scrubSecret } from '../src/zerobounce/errors.js';
import { InvalidRegionError, parseRegion, REALTIME_HOSTS } from '../src/zerobounce/regions.js';
import { parseCsv, toCsv } from '../src/utils/csv.js';
import { describeStatus } from '../src/zerobounce/statuses.js';
import { maskKey, safeEqual, sanitizeUrlForLogs } from '../src/utils/security.js';

test('extractApiError understands every ZeroBounce error shape', () => {
  assert.equal(extractApiError({ Credits: -1 }), 'Invalid API Key');
  assert.equal(extractApiError({ Credits: '-1' }), 'Invalid API Key');
  assert.equal(extractApiError({ Credits: '250' }), undefined);
  assert.equal(extractApiError({ error: 'Invalid API Key or your account ran out of credits' }), 'Invalid API Key or your account ran out of credits');
  assert.equal(extractApiError({ Error: 'Missing param: rule' }), 'Missing param: rule');
  assert.equal(extractApiError({ success: false, error_message: 'File cannot be found.' }), 'File cannot be found.');
  assert.equal(extractApiError({ success: 'False', message: ['api_key is invalid'] }), 'api_key is invalid');
  assert.equal(extractApiError({ success: false, error_message: '' }), 'ZeroBounce reported the request as unsuccessful.');
  // "Message" is only an error where the caller says so (guessformat), not for filters.
  assert.equal(extractApiError({ Message: 'Filter successfully added' }), undefined);
  assert.equal(extractApiError({ Message: 'Invalid API key' }, { messageIsError: true }), 'Invalid API key');
  // Normal responses
  assert.equal(extractApiError({ address: 'a@b.com', status: 'valid' }), undefined);
  assert.equal(extractApiError([{ rule: 'allow' }]), undefined);
  assert.equal(extractApiError({ file_id: 'x', status: 'processing', error_message: '' }), undefined);
});

test('auth-related messages become friendly auth errors', () => {
  const err = errorFromApiMessage('Invalid API Key or your account ran out of credits');
  assert.equal(err.kind, 'auth');
  assert.match(err.message, /API Keys in your ZeroBounce dashboard/);
  assert.equal(errorFromApiMessage('Please provide a valid email address', 400).kind, 'bad_request');
});

test('HTTP status errors map to the right kinds', () => {
  assert.equal(errorFromHttpStatus(429).kind, 'rate_limited');
  assert.equal(errorFromHttpStatus(403, '<html>cloudflare</html>').kind, 'firewall');
  assert.doesNotMatch(errorFromHttpStatus(403, '<html>cloudflare</html>').message, /cloudflare/);
  assert.equal(errorFromHttpStatus(524).kind, 'server');
  assert.equal(errorFromHttpStatus(404).kind, 'not_found');
});

test('scrubSecret removes the API key from text', () => {
  assert.equal(scrubSecret('bad key abc123secret here', 'abc123secret'), 'bad key *** here');
});

test('parseRegion accepts allowlisted values only', () => {
  assert.equal(parseRegion(undefined), 'default');
  assert.equal(parseRegion(''), 'default');
  assert.equal(parseRegion(' US '), 'us');
  assert.equal(parseRegion('eu'), 'eu');
  assert.equal(parseRegion('https://api-eu.zerobounce.net/v2'), 'eu');
  assert.equal(parseRegion('api-us.zerobounce.net'), 'us');
  assert.throws(() => parseRegion('https://evil.example.com'), InvalidRegionError);
  assert.throws(() => parseRegion('asia'), InvalidRegionError);
  assert.equal(REALTIME_HOSTS.us, 'https://api-us.zerobounce.net/v2');
});

test('CSV round-trips quotes, commas and newlines', () => {
  const rows = [
    ['email', 'note'],
    ['a@b.com', 'plain'],
    ['c@d.com', 'has, comma'],
    ['e@f.com', 'has "quotes"'],
    ['g@h.com', 'multi\nline'],
  ];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test('parseCsv handles BOM, CRLF, blank lines and ZeroBounce-style spacing', () => {
  const sample = '﻿"Email Address", "ZB Status", "ZB Sub Status"\r\n"a@b.com", "valid", ""\r\n\r\n"c@d.com","invalid","mailbox_not_found"';
  assert.deepEqual(parseCsv(sample), [
    ['Email Address', 'ZB Status', 'ZB Sub Status'],
    ['a@b.com', 'valid', ''],
    ['c@d.com', 'invalid', 'mailbox_not_found'],
  ]);
});

test('describeStatus gives verdicts and sub-status meanings', () => {
  assert.equal(describeStatus('valid').verdict, 'SAFE');
  assert.equal(describeStatus('catch-all').verdict, 'RISKY');
  assert.equal(describeStatus('unknown').verdict, 'UNVERIFIED');
  assert.equal(describeStatus('invalid').verdict, 'WILL BOUNCE');
  assert.equal(describeStatus('do_not_mail', 'disposable').verdict, 'DO NOT SEND');
  assert.match(describeStatus('do_not_mail', 'disposable').subStatusMeaning ?? '', /disposable/i);
});

test('security helpers mask keys and compare safely', () => {
  assert.equal(maskKey('usr_0123456789abcdef0123456789abcdef'), 'usr_01234567...');
  assert.equal(sanitizeUrlForLogs('/mcp/usr_abc123?x=1'), '/mcp/:userKey?x=1');
  assert.equal(sanitizeUrlForLogs('/mcp?api_key=usr_abc&y=2'), '/mcp?api_key=***&y=2');
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual(undefined, 'abc'), false);
});
