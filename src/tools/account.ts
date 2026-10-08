/**
 * Account tools: credit balance and API usage (both free).
 */

import { z } from 'zod';
import { formatNumber, isoDate, table } from '../utils/format.js';
import { READ_ONLY, defineTool, jsonResult, responseFormatSchema, textResult, ToolInputError } from './shared.js';

// A factory, not a shared instance: reusing one zod object for two fields makes the
// JSON Schema contain a "$ref", which some strict MCP clients reject.
const dateSchema = () =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
    .describe('Date in YYYY-MM-DD format');

export const getCredits = defineTool({
  name: 'zerobounce_get_credits',
  title: 'Get ZeroBounce credit balance',
  group: 'Account',
  description:
    'Get the remaining ZeroBounce credit balance. Use this before large jobs (batch or bulk validation, email finding) to check there are enough credits.',
  cost: 'Free',
  inputSchema: { response_format: responseFormatSchema },
  annotations: READ_ONLY,
  async handler({ response_format }, ctx) {
    const credits = await ctx.getClient().getCredits();
    if (response_format === 'json') return jsonResult({ credits });
    return textResult(`**ZeroBounce credit balance:** ${formatNumber(credits)} credits`);
  },
});

export const getApiUsage = defineTool({
  name: 'zerobounce_get_api_usage',
  title: 'Get ZeroBounce API usage',
  group: 'Account',
  description:
    'Get API usage for a date range: total validations plus a breakdown by status (valid, invalid, catch-all...) and sub-status. Defaults to the last 30 days.',
  cost: 'Free',
  inputSchema: {
    start_date: dateSchema().optional().describe('Start date (YYYY-MM-DD). Defaults to 30 days before end_date.'),
    end_date: dateSchema().optional().describe("End date (YYYY-MM-DD). Defaults to today's date (UTC)."),
    response_format: responseFormatSchema,
  },
  annotations: READ_ONLY,
  async handler({ start_date, end_date, response_format }, ctx) {
    const end = end_date ?? isoDate(0);
    const start = start_date ?? isoDate(-30, new Date(`${end}T00:00:00Z`));
    if (start > end) throw new ToolInputError('start_date must be on or before end_date.');

    const usage = await ctx.getClient().getApiUsage(start, end);
    if (response_format === 'json') return jsonResult(usage);

    const statusRows: Array<[string, number]> = [];
    const subStatusRows: Array<[string, number]> = [];
    for (const [key, raw] of Object.entries(usage)) {
      const count = Number(raw);
      if (!Number.isFinite(count) || count <= 0) continue;
      if (key.startsWith('sub_status_')) subStatusRows.push([key.slice('sub_status_'.length), count]);
      else if (key.startsWith('status_')) statusRows.push([key.slice('status_'.length), count]);
    }
    statusRows.sort((a, b) => b[1] - a[1]);
    subStatusRows.sort((a, b) => b[1] - a[1]);

    const total = Number(usage.total ?? 0);
    const lines = [`## ZeroBounce API usage: ${start} to ${end}`, '', `**Total API calls:** ${formatNumber(total)}`];
    if (statusRows.length) {
      lines.push('', '### By status', table(['Status', 'Count'], statusRows.map(([k, v]) => [k, formatNumber(v)])));
    }
    if (subStatusRows.length) {
      lines.push('', '### By sub-status', table(['Sub-status', 'Count'], subStatusRows.map(([k, v]) => [k, formatNumber(v)])));
    }
    if (!statusRows.length && !subStatusRows.length) lines.push('', 'No usage recorded in this period.');
    return textResult(lines.join('\n'));
  },
});

export const accountTools = [getCredits, getApiUsage];
