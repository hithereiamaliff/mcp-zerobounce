/**
 * Email Finder and Domain Search.
 *
 * Both use the same ZeroBounce endpoint (/v2/guessformat): sending a person's
 * name makes it an Email Finder lookup, leaving names out makes it a Domain
 * Search (the email format a company uses).
 */

import { z } from 'zod';
import type { GuessFormatResult } from '../zerobounce/types.js';
import { bullets, hasValue, table } from '../utils/format.js';
import { SPENDS_CREDITS, ToolInputError, defineTool, jsonResult, responseFormatSchema, textResult } from './shared.js';

const FAILURE_REASONS: Record<string, string> = {
  FREE_DOMAIN_ERROR: 'Free email providers (gmail.com, yahoo.com...) are not supported.',
  DOMAIN_SYNTAX_ERROR: "The domain isn't valid.",
  COMPANY_DOMAIN_ERROR: "Couldn't determine the company's domain.",
  COMPANY_DOMAIN_NOT_FOUND: 'No domain was found for that company name.',
  UNEXPECTED_ERROR_OCCURRED_DURING_VALIDATION: 'ZeroBounce hit an unexpected error. Try again later.',
  DOMAIN_DOES_NOT_ACCEPT_MAIL: "The domain doesn't accept email.",
  NO_DATA_FOR_THIS_DOMAIN: 'ZeroBounce has no data for this domain.',
  NO_DATA_FOR_THIS_COMPANY: 'ZeroBounce has no data for this company.',
};

function explainFailure(reason: string | undefined): string | undefined {
  if (!hasValue(reason)) return undefined;
  const key = String(reason).toUpperCase();
  return FAILURE_REASONS[key] ? `${FAILURE_REASONS[key]} (${key})` : String(reason);
}

const domainSchema = z
  .string()
  .trim()
  .min(3)
  .max(253)
  .optional()
  .describe('Company email domain, e.g. "acme.com". Provide either domain or company_name.');

const companySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional()
  .describe('Company name, e.g. "Acme Inc". Provide either domain or company_name.');

function requireOneTarget(domain?: string, companyName?: string) {
  if (!domain && !companyName) throw new ToolInputError('Provide either domain or company_name.');
  if (domain && companyName) {
    throw new ToolInputError('Provide only one of domain or company_name (ZeroBounce rejects both together).');
  }
}

export function formatFindEmail(result: GuessFormatResult, person: string): string {
  const confidence = result.email_confidence ?? result.confidence;
  if (hasValue(result.email)) {
    return [
      `## Email found for ${person}`,
      '',
      `**Email:** ${result.email}`,
      bullets([
        ['Confidence', confidence ? String(confidence).toLowerCase() : undefined],
        ['Domain', result.domain],
        ['Company', result.company_name],
        ['Did you mean', result.did_you_mean],
      ]),
      '',
      'Tip: run zerobounce_validate_email on the result before mailing it.',
    ].join('\n');
  }
  return [
    `## No email found for ${person}`,
    '',
    bullets([
      ['Reason', explainFailure(result.failure_reason) ?? 'ZeroBounce could not determine an address.'],
      ['Domain', result.domain],
      ['Company', result.company_name],
      ['Did you mean', result.did_you_mean],
    ]),
    '',
    'No credits are charged when nothing is found.',
  ].join('\n');
}

export function formatDomainSearch(result: GuessFormatResult, target: string): string {
  const lines: string[] = [];
  if (hasValue(result.format)) {
    lines.push(
      `## Email format for ${target}`,
      '',
      `**Format:** \`${result.format}\`` + (hasValue(result.confidence) ? ` (confidence: ${String(result.confidence).toLowerCase()})` : ''),
    );
  } else {
    lines.push(`## No email format found for ${target}`);
  }
  const details = bullets([
    ['Domain', result.domain],
    ['Company', result.company_name],
    ['Did you mean', result.did_you_mean],
    ['Reason', explainFailure(result.failure_reason)],
  ]);
  if (details) lines.push('', details);

  const others = Array.isArray(result.other_domain_formats) ? result.other_domain_formats : [];
  if (others.length) {
    lines.push(
      '',
      '### Other formats seen',
      table(['Format', 'Confidence'], others.map(o => [`\`${o.format}\``, String(o.confidence ?? '').toLowerCase()])),
    );
  }
  return lines.join('\n');
}

export const findEmail = defineTool({
  name: 'zerobounce_find_email',
  title: "Find a person's email address",
  group: 'Email Finder',
  description:
    "Find a person's business email address from their name and company domain (or company name). " +
    'Returns the most likely address and a confidence level. Free email domains (gmail.com etc.) are not supported.',
  cost: '20 credits per address found (or 1 query on an Email Finder subscription); nothing charged if not found',
  inputSchema: {
    first_name: z.string().trim().min(1).max(100).describe("Person's first name"),
    last_name: z.string().trim().max(100).optional().describe("Person's last name (strongly recommended)"),
    middle_name: z.string().trim().max(100).optional().describe("Person's middle name"),
    domain: domainSchema,
    company_name: companySchema,
    response_format: responseFormatSchema,
  },
  annotations: SPENDS_CREDITS,
  async handler(args, ctx) {
    requireOneTarget(args.domain, args.company_name);
    const result = await ctx.getClient().guessFormat({
      domain: args.domain,
      companyName: args.company_name,
      firstName: args.first_name,
      middleName: args.middle_name,
      lastName: args.last_name,
    });
    if (args.response_format === 'json') return jsonResult(result);
    const person = [args.first_name, args.middle_name, args.last_name].filter(Boolean).join(' ');
    return textResult(formatFindEmail(result, `${person} at ${args.domain ?? args.company_name}`));
  },
});

export const domainSearch = defineTool({
  name: 'zerobounce_domain_search',
  title: "Find a company's email format",
  group: 'Email Finder',
  description:
    'Find the email address format a company uses (for example first.last@acme.com) from its domain or company name, plus other formats seen and their confidence.',
  cost: '20 credits per format found (or 1 query on an Email Finder subscription); nothing charged if not found',
  inputSchema: {
    domain: domainSchema,
    company_name: companySchema,
    response_format: responseFormatSchema,
  },
  annotations: SPENDS_CREDITS,
  async handler(args, ctx) {
    requireOneTarget(args.domain, args.company_name);
    const result = await ctx.getClient().guessFormat({ domain: args.domain, companyName: args.company_name });
    if (args.response_format === 'json') return jsonResult(result);
    return textResult(formatDomainSearch(result, String(args.domain ?? args.company_name)));
  },
});

export const finderTools = [findEmail, domainSearch];
