#!/usr/bin/env node
/**
 * Live smoke test against the real ZeroBounce API, using ZERO credits.
 *
 * Starts the built stdio server (dist/cli.js) as a real MCP client would and
 * calls only free tools plus validations of ZeroBounce's sandbox addresses
 * (which never use credits). It checks the credit balance before and after.
 *
 * Usage:
 *   npm run build
 *   ZEROBOUNCE_API_KEY=... npm run smoke        (or put the key in a local .env file)
 *   ZEROBOUNCE_REGION=us npm run smoke          (optional region)
 */

import { readFileSync, existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Minimal .env loader (no dependency); never prints values.
if (!process.env.ZEROBOUNCE_API_KEY && existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf-8').split(/\r?\n/)) {
    const match = /^\s*(ZEROBOUNCE_API_KEY|ZEROBOUNCE_REGION)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

if (!process.env.ZEROBOUNCE_API_KEY) {
  console.error('Set ZEROBOUNCE_API_KEY (environment or .env) to run the live smoke test.');
  process.exit(1);
}
if (!existsSync('dist/cli.js')) {
  console.error('Run "npm run build" first.');
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/cli.js'],
  env: {
    PATH: process.env.PATH ?? '',
    ZEROBOUNCE_API_KEY: process.env.ZEROBOUNCE_API_KEY,
    ...(process.env.ZEROBOUNCE_REGION ? { ZEROBOUNCE_REGION: process.env.ZEROBOUNCE_REGION } : {}),
  },
  stderr: 'inherit',
});
const client = new Client({ name: 'smoke-test', version: '1.0.0' });
await client.connect(transport);

let failures = 0;
async function check(label, name, args, expect) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.map(c => c.text).join('\n');
  const ok = !result.isError && (!expect || expect.test(text));
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(text.split('\n').map(l => `      ${l}`).join('\n'));
  return text;
}

async function credits() {
  const result = await client.callTool({ name: 'zerobounce_get_credits', arguments: { response_format: 'json' } });
  return result.isError ? NaN : JSON.parse(result.content[0].text).credits;
}

const tools = await client.listTools();
console.log(`Connected: ${tools.tools.length} tools\n`);

await check('hello', 'zerobounce_hello', {}, /operational/);
const before = await credits();
console.log(`${Number.isFinite(before) ? 'PASS' : 'FAIL'}  get_credits (${before})`);
if (!Number.isFinite(before)) failures++;

await check('get_api_usage (last 30 days)', 'zerobounce_get_api_usage', {}, /API usage/);
await check('list_filters', 'zerobounce_list_filters', {});

// Sandbox addresses: fixed results, no credits used.
await check('validate valid@example.com → SAFE', 'zerobounce_validate_email', { email: 'valid@example.com' }, /SAFE/);
await check('validate invalid@example.com → WILL BOUNCE', 'zerobounce_validate_email', { email: 'invalid@example.com' }, /WILL BOUNCE/);
await check('validate catch_all@example.com → RISKY', 'zerobounce_validate_email', { email: 'catch_all@example.com' }, /RISKY/);
await check('validate disposable@example.com → DO NOT SEND', 'zerobounce_validate_email', { email: 'disposable@example.com' }, /DO NOT SEND/);

const after = await credits();
const unchanged = before === after;
if (!unchanged) failures++;
console.log(`${unchanged ? 'PASS' : 'FAIL'}  credits unchanged (${before} → ${after})`);

await client.close();
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed. No credits were used.');
process.exit(failures ? 1 : 0);
