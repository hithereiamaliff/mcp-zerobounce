/**
 * Allow / block filters (all free).
 *
 * Filters override validation results: an allow match returns valid/allowed,
 * a block match returns do_not_mail/blocked. Priority: email > domain > tld > mx.
 * Changes can take up to a minute to apply.
 */

import { z } from 'zod';
import { table } from '../utils/format.js';
import { DESTRUCTIVE, READ_ONLY, defineTool, jsonResult, responseFormatSchema, textResult } from './shared.js';

const ruleSchema = z.enum(['allow', 'block']).describe('"allow" (always treat as valid) or "block" (always treat as do_not_mail)');
const targetSchema = z
  .enum(['email', 'domain', 'mx', 'tld'])
  .describe('What the value matches: a full email address, a domain, a mail server (mx, may start with * as a wildcard), or a top-level domain such as "xyz"');
const valueSchema = z.string().trim().min(1).max(320).describe('The email, domain, mx host or tld to match');

export const listFilters = defineTool({
  name: 'zerobounce_list_filters',
  title: 'List allow/block filters',
  group: 'Filters',
  description: 'List the allow and block filter rules on the ZeroBounce account.',
  cost: 'Free',
  inputSchema: { response_format: responseFormatSchema },
  annotations: READ_ONLY,
  async handler({ response_format }, ctx) {
    const filters = await ctx.getClient().listFilters();
    if (response_format === 'json') return jsonResult(filters);
    if (!filters.length) return textResult('No allow/block filters are set on this account.');
    const sorted = [...filters].sort((a, b) => `${a.rule}${a.target}${a.value}`.localeCompare(`${b.rule}${b.target}${b.value}`));
    return textResult(
      [`## ZeroBounce filters (${filters.length})`, '', table(['Rule', 'Target', 'Value'], sorted.map(f => [f.rule, f.target, f.value]))].join('\n'),
    );
  },
});

export const addFilter = defineTool({
  name: 'zerobounce_add_filter',
  title: 'Add an allow/block filter',
  group: 'Filters',
  description:
    'Add an allow or block rule so matching addresses always validate as valid (allow) or do_not_mail (block). ' +
    'Sending an existing target/value with a different rule updates that rule. Takes up to a minute to apply.',
  cost: 'Free',
  inputSchema: { rule: ruleSchema, target: targetSchema, value: valueSchema },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async handler({ rule, target, value }, ctx) {
    const message = await ctx.getClient().addFilter({ rule, target, value });
    return textResult(`${message}: **${rule}** ${target} \`${value}\``);
  },
});

export const deleteFilter = defineTool({
  name: 'zerobounce_delete_filter',
  title: 'Delete an allow/block filter',
  group: 'Filters',
  description: 'Delete an allow or block rule. Use zerobounce_list_filters to see the exact rule, target and value.',
  cost: 'Free',
  inputSchema: { rule: ruleSchema, target: targetSchema, value: valueSchema },
  annotations: DESTRUCTIVE,
  async handler({ rule, target, value }, ctx) {
    const message = await ctx.getClient().deleteFilter({ rule, target, value });
    return textResult(`${message}: **${rule}** ${target} \`${value}\``);
  },
});

export const filterTools = [listFilters, addFilter, deleteFilter];
