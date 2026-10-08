/**
 * List Evaluator (free): estimates how risky a list is before you pay to validate it.
 * Source: https://www.zerobounce.net/docs/list-evaluator-api
 */

import { z } from 'zod';
import type { ListEvaluatorResult } from '../zerobounce/types.js';
import { parseCsv, toCsv } from '../utils/csv.js';
import { bullets, formatNumber, hasValue, isTrue } from '../utils/format.js';
import {
  READ_ONLY,
  SPENDS_CREDITS,
  ToolInputError,
  defineTool,
  emailSchema,
  jsonResult,
  readLocalFile,
  responseFormatSchema,
  textResult,
} from './shared.js';

const MIN_EMAILS = 100;

function percent(value: unknown): string | undefined {
  if (!hasValue(value)) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? `${n}%` : String(value);
}

function yesNo(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return isTrue(value) ? 'Yes, found in the sample' : 'None found';
}

export function formatEvaluation(result: ListEvaluatorResult, fileId: string): string {
  const status = String(result.status ?? 'unknown');
  const finished = /finish|complete/i.test(status);
  const lines = [
    `## List evaluation: ${finished ? 'finished' : status}`,
    '',
    bullets([
      ['File ID', `\`${result.file_id ?? fileId}\``],
      ['Progress', hasValue(result.progress) ? `${result.progress}%` : undefined],
      ['Total risky', percent(result.total_risky_percentage)],
      ['Invalid', percent(result.invalid_percentage)],
      ['Catch-all', percent(result.catch_all_percentage)],
      ['Activity data found', percent(result.activity_data_percentage)],
      ['Spam traps', yesNo(result.spam_trap)],
      ['Abuse addresses', yesNo(result.abuse)],
      ['Do-not-mail addresses', yesNo(result.do_not_mail)],
      ['Error', result.error_message],
    ]),
  ];
  lines.push(
    '',
    finished
      ? 'To clean the list, submit it with zerobounce_bulk_validate (1 credit per email).'
      : `Still evaluating. Check again shortly with zerobounce_evaluate_list_status and file_id "${result.file_id ?? fileId}".`,
  );
  return lines.join('\n');
}

export const evaluateList = defineTool({
  name: 'zerobounce_evaluate_list',
  title: 'Evaluate a list (free risk estimate)',
  group: 'List Evaluator',
  description:
    'Get a free estimate of how risky an email list is (percentage invalid, catch-all, and whether spam traps/abuse/do-not-mail addresses are present) before paying to validate it. ' +
    `Needs at least ${MIN_EMAILS} addresses. Pass \`emails\`, or \`csv_content\` with email_address_column. Returns a file_id to check with zerobounce_evaluate_list_status.`,
  cost: 'Free (rate-limited by ZeroBounce based on your credit history)',
  inputSchema: {
    emails: z.array(emailSchema).min(MIN_EMAILS).max(100_000).optional().describe(`Email addresses to evaluate (at least ${MIN_EMAILS})`),
    csv_content: z.string().min(1).max(5_000_000).optional().describe('Raw CSV text (alternative to emails)'),
    email_address_column: z.number().int().min(1).max(500).optional().describe('1-based column number of the email address in csv_content (default 1)'),
    has_header_row: z.boolean().optional().describe('Whether csv_content / the file starts with a header row (default true)'),
  },
  localInputSchema: {
    file_path: z.string().min(1).optional().describe('Path to a local CSV or TXT file to evaluate'),
  },
  annotations: SPENDS_CREDITS,
  async handler(args, ctx) {
    const sources = [args.emails && 'emails', args.csv_content && 'csv_content', args.file_path && 'file_path'].filter(Boolean);
    if (sources.length !== 1) {
      throw new ToolInputError(
        `Provide exactly one of ${ctx.allowLocalFiles ? 'emails, csv_content or file_path' : 'emails or csv_content'}.`,
      );
    }

    // ZeroBounce's List Evaluator always treats the first row as a header (it has no
    // has_header_row option; confirmed against the live API). So the upload must always
    // start with a header row, or the first address is silently dropped.
    let header: string[];
    let rows: string[][];
    let column = 1;
    let fileName = `mcp-list-evaluation-${Date.now()}.csv`;
    if (args.emails) {
      header = ['email'];
      rows = args.emails.map(e => [e]);
    } else {
      let content = args.csv_content as string;
      if (args.file_path) {
        const file = await readLocalFile(args.file_path, ctx);
        content = file.content;
        fileName = file.fileName;
      }
      const all = parseCsv(content);
      column = args.email_address_column ?? 1;
      const widest = all.reduce((max, r) => Math.max(max, r.length), 0);
      if (column > widest) throw new ToolInputError(`email_address_column is ${column}, but the CSV only has ${widest} column(s).`);
      if (args.has_header_row ?? true) {
        header = all[0] ?? [];
        rows = all.slice(1);
      } else {
        // No header in the caller's data: add a generic one so no address is lost.
        header = Array.from({ length: widest }, (_, i) => (i + 1 === column ? 'email' : `column_${i + 1}`));
        rows = all;
      }
    }

    // Check the minimum locally: ZeroBounce counts rejected requests towards a temporary block.
    if (rows.length < MIN_EMAILS) {
      throw new ToolInputError(`The List Evaluator needs at least ${MIN_EMAILS} email addresses (got ${rows.length}).`);
    }

    const result = await ctx.getClient().evaluateList(toCsv([header, ...rows]), fileName, column);
    return textResult(
      `Submitted ${formatNumber(rows.length)} addresses for evaluation.\n\n` + formatEvaluation(result, String(result.file_id ?? '')),
    );
  },
});

export const evaluateListStatus = defineTool({
  name: 'zerobounce_evaluate_list_status',
  title: 'Get list evaluation results',
  group: 'List Evaluator',
  description: 'Get the progress and results of a List Evaluator job started with zerobounce_evaluate_list.',
  cost: 'Free',
  inputSchema: {
    file_id: z.string().trim().min(1).max(128).describe('The file_id returned by zerobounce_evaluate_list'),
    response_format: responseFormatSchema,
  },
  annotations: READ_ONLY,
  async handler({ file_id, response_format }, ctx) {
    const result = await ctx.getClient().evaluateListStatus(file_id);
    return response_format === 'json' ? jsonResult(result) : textResult(formatEvaluation(result, file_id));
  },
});

export const listEvaluatorTools = [evaluateList, evaluateListStatus];
