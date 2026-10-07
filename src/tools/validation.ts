/**
 * Real-time validation tools: single email, batch (≤100), activity data, AI score.
 */

import { z } from 'zod';
import type { ValidateResult } from '../zerobounce/types.js';
import { describeStatus, type Verdict } from '../zerobounce/statuses.js';
import { bullets, formatNumber, hasValue, isTrue, table } from '../utils/format.js';
import {
  SPENDS_CREDITS,
  defineTool,
  emailSchema,
  jsonResult,
  responseFormatSchema,
  textResult,
} from './shared.js';

const SANDBOX_HINT =
  'Tip: ZeroBounce test addresses such as valid@example.com, invalid@example.com, catch_all@example.com or disposable@example.com return fixed results and use no credits.';

/** Markdown for one validation result. Exported for tests. */
export function formatValidation(result: ValidateResult): string {
  const { verdict, meaning, subStatusMeaning } = describeStatus(result.status, result.sub_status);
  const lines = [`## ${result.address}: ${verdict}`, '', `**Status:** ${result.status}. ${meaning}`];
  if (result.sub_status) lines.push(`**Sub-status:** ${result.sub_status}. ${subStatusMeaning}`);
  if (hasValue(result.did_you_mean)) lines.push(`**Did you mean:** ${result.did_you_mean}`);

  const name = [result.firstname, result.lastname].filter(hasValue).join(' ');
  const location = [result.city, result.region, result.country].filter(hasValue).join(', ');
  const domainAge = hasValue(result.domain_age_days) ? ` (domain age: ${result.domain_age_days} days)` : '';
  const mx = hasValue(result.mx_record) ? `${result.mx_record}` : isTrue(result.mx_found) ? 'found' : undefined;

  let activity: string | undefined;
  if ('active_in_days' in result) {
    activity = hasValue(result.active_in_days)
      ? `active within the last ${result.active_in_days} days` +
        (hasValue(result.active_first_seen) ? ` (first seen ${result.active_first_seen})` : '')
      : 'no activity data';
  }

  let website: string | undefined;
  if ('domain_website_exists' in result) {
    const exists = result.domain_website_exists;
    website = exists === 'unchecked' ? 'not checked' : isTrue(exists) ? 'yes' : 'no';
    if (hasValue(result.domain_registrant_company_name)) website += `; registrant: ${result.domain_registrant_company_name}`;
  }

  const details = bullets([
    ['Free email provider', 'free_email' in result ? (isTrue(result.free_email) ? 'Yes' : 'No') : undefined],
    ['Domain', hasValue(result.domain) ? `${result.domain}${domainAge}` : undefined],
    ['MX record', mx],
    ['SMTP provider', result.smtp_provider],
    ['Name', name || undefined],
    ['Gender', result.gender],
    ['Location', location || undefined],
    ['Activity', activity],
    ['Website exists', website],
    ['Processed at', hasValue(result.processed_at) ? `${result.processed_at} UTC` : undefined],
  ]);
  if (details) lines.push('', details);
  return lines.join('\n');
}

export const validateEmail = defineTool({
  name: 'zerobounce_validate_email',
  title: 'Validate an email address',
  group: 'Validation',
  description:
    'Check whether one email address is deliverable. Returns a verdict (SAFE, RISKY, UNVERIFIED, WILL BOUNCE or DO NOT SEND) with the ZeroBounce status, sub-status, typo suggestion, and details such as free-provider, domain, MX and SMTP provider. ' +
    'Use zerobounce_validate_batch for 2-100 addresses. ' +
    SANDBOX_HINT,
  cost: '1 credit (unknown results are not charged)',
  inputSchema: {
    email: emailSchema.describe('The email address to validate'),
    ip_address: z.string().trim().max(45).optional().describe('IP address the email signed up from (optional; adds geolocation)'),
    timeout: z
      .number()
      .int()
      .min(3)
      .max(60)
      .optional()
      .describe('Seconds ZeroBounce may spend validating (3-60, default 30). Hitting it returns status "unknown".'),
    activity_data: z.boolean().optional().describe('Include Activity Data (when the address was last active)'),
    verify_plus: z.boolean().optional().describe("Use Verify+ (overrides the account's setting)"),
    domain_info: z.boolean().optional().describe('Include domain WHOIS/website information'),
    response_format: responseFormatSchema,
  },
  annotations: SPENDS_CREDITS,
  async handler(args, ctx) {
    const result = await ctx.getClient().validate({
      email: args.email,
      ipAddress: args.ip_address,
      timeout: args.timeout,
      activityData: args.activity_data,
      verifyPlus: args.verify_plus,
      domainInfo: args.domain_info,
    });
    return args.response_format === 'json' ? jsonResult(result) : textResult(formatValidation(result));
  },
});

const VERDICT_ORDER: Verdict[] = ['SAFE', 'RISKY', 'UNVERIFIED', 'WILL BOUNCE', 'DO NOT SEND'];

export const validateBatch = defineTool({
  name: 'zerobounce_validate_batch',
  title: 'Validate up to 100 email addresses',
  group: 'Validation',
  description:
    'Validate 1-100 email addresses in one request. Duplicates are removed before sending (so they are not charged twice). ' +
    'Returns a verdict summary and a per-address table. ZeroBounce allows about 30 batch requests per minute; for bigger lists use zerobounce_bulk_validate. ' +
    SANDBOX_HINT,
  cost: '1 credit per unique email (unknown results are not charged)',
  inputSchema: {
    emails: z.array(emailSchema).min(1).max(100).describe('Email addresses to validate (1-100)'),
    timeout: z
      .number()
      .int()
      .min(10)
      .max(120)
      .optional()
      .describe('Seconds ZeroBounce may spend on the batch (10-120)'),
    activity_data: z.boolean().optional().describe('Include Activity Data for each address'),
    verify_plus: z.boolean().optional().describe("Use Verify+ (overrides the account's setting)"),
    response_format: responseFormatSchema,
  },
  annotations: SPENDS_CREDITS,
  async handler(args, ctx) {
    // Case-insensitive de-duplication, keeping the first spelling.
    const seen = new Set<string>();
    const unique = args.emails.filter(email => {
      const key = email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const duplicates = args.emails.length - unique.length;

    const result = await ctx.getClient().validateBatch({
      emails: unique.map(email => ({ email })),
      timeout: args.timeout,
      activityData: args.activity_data,
      verifyPlus: args.verify_plus,
    });
    if (args.response_format === 'json') return jsonResult({ ...result, duplicates_removed: duplicates });

    const counts = new Map<Verdict, number>();
    const rows = result.email_batch.map(item => {
      const { verdict } = describeStatus(item.status, item.sub_status);
      counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
      return [item.address, verdict, item.status, item.sub_status || '', hasValue(item.did_you_mean) ? item.did_you_mean : ''];
    });

    const lines = [`## Batch validation: ${formatNumber(result.email_batch.length)} addresses`];
    if (duplicates > 0) lines.push('', `${duplicates} duplicate address(es) removed before sending.`);
    lines.push(
      '',
      table(
        ['Verdict', 'Count'],
        VERDICT_ORDER.filter(v => counts.has(v)).map(v => [v, counts.get(v)]),
      ),
      '',
      table(['Email', 'Verdict', 'Status', 'Sub-status', 'Did you mean'], rows),
    );
    if (result.errors.length) {
      lines.push('', '### Errors', ...result.errors.map(e => `- ${e.email_address}: ${e.error}`));
    }
    return textResult(lines.join('\n'));
  },
});

export const getActivityData = defineTool({
  name: 'zerobounce_get_activity_data',
  title: 'Get email activity data',
  group: 'Validation',
  description:
    'Check when an email address was last active (opens, clicks, logins, etc.). Returns a bucket such as "active within the last 30/60/90/180/365 days" and when ZeroBounce first saw activity.',
  cost: 'No credit when no activity is found; requires a ZeroBounce ONE subscription',
  inputSchema: {
    email: emailSchema.describe('The email address to look up'),
    response_format: responseFormatSchema,
  },
  annotations: SPENDS_CREDITS,
  async handler({ email, response_format }, ctx) {
    const result = await ctx.getClient().getActivity(email);
    if (response_format === 'json') return jsonResult(result);
    if (!isTrue(result.found)) return textResult(`**${email}:** no activity data found.`);
    const window = hasValue(result.active_in_days) ? `within the last ${result.active_in_days} days` : 'at some point';
    const firstSeen = hasValue(result.active_first_seen) ? ` First seen active on ${result.active_first_seen}.` : '';
    return textResult(`**${email}:** active ${window}.${firstSeen}`);
  },
});

export const scoreEmail = defineTool({
  name: 'zerobounce_score_email',
  title: 'AI-score an email address',
  group: 'Validation',
  description:
    "Get ZeroBounce's AI quality score for one email address, from 0 (lowest) to 10 (highest). Useful for prioritising leads, especially catch-all addresses that validation can't confirm.",
  cost: '1 credit',
  inputSchema: {
    email: emailSchema.describe('The email address to score'),
    response_format: responseFormatSchema,
  },
  annotations: SPENDS_CREDITS,
  async handler({ email, response_format }, ctx) {
    const result = await ctx.getClient().scoreEmail(email);
    if (response_format === 'json') return jsonResult(result);
    return textResult(`**${result.email ?? email}:** AI score ${result.score}/10 (0 = lowest quality, 10 = highest).`);
  },
});

export const validationTools = [validateEmail, validateBatch, getActivityData, scoreEmail];
