/**
 * Bulk file tools (bulkapi.zerobounce.net).
 *
 * Four services share the same flow:
 *   submit (sendfile) → zerobounce_bulk_status → zerobounce_bulk_results → zerobounce_bulk_delete
 *
 * Input safety: over HTTP the server NEVER touches its own filesystem. Callers send
 * a list (emails / contacts / domains) or raw CSV text, and we build the upload in
 * memory. `file_path` / `save_to_path` exist only in local CLI mode.
 *
 * Output: results files can have tens of thousands of rows, so instead of dumping
 * the CSV into the model's context we return a summary or one page of rows.
 */

import { z } from 'zod';
import { FILE_SERVICES, type FileService, type ZeroBounceClient } from '../zerobounce/client.js';
import { describeStatus, type Verdict } from '../zerobounce/statuses.js';
import type { FileStatusResult, FileSubmitResult } from '../zerobounce/types.js';
import { parseCsv, toCsv } from '../utils/csv.js';
import { bullets, formatNumber, hasValue, table } from '../utils/format.js';
import {
  DESTRUCTIVE,
  READ_ONLY,
  SPENDS_CREDITS,
  ToolInputError,
  defineTool,
  emailSchema,
  jsonResult,
  readLocalFile,
  responseFormatSchema,
  textResult,
  writeLocalFile,
  type ToolContext,
} from './shared.js';

export const SERVICE_LABELS: Record<FileService, string> = {
  validation: 'Bulk validation',
  scoring: 'AI scoring',
  email_finder: 'Bulk email finder',
  domain_search: 'Bulk domain search',
};

// =============================================================================
// Shared schemas
// =============================================================================

const serviceSchema = z
  .enum(FILE_SERVICES as [FileService, ...FileService[]])
  .describe('The bulk service the file was submitted to: "validation", "scoring", "email_finder" or "domain_search"');

const fileIdSchema = z.string().trim().min(1).max(128).describe('The file_id returned when the file was submitted');

const column = (what: string) =>
  z.number().int().min(1).max(500).optional().describe(`1-based column number of ${what} in csv_content / the file`);

const csvContentSchema = z
  .string()
  .min(1)
  .max(5_000_000)
  .optional()
  .describe('Raw CSV text to upload, as an alternative to passing a list. Use the *_column parameters to say which column holds what.');

const hasHeaderSchema = z
  .boolean()
  .optional()
  .describe('Whether csv_content / the file starts with a header row (default true). Ignored when passing a list.');

const fileNameSchema = z
  .string()
  .trim()
  .max(100)
  .regex(/^[\w .()-]+$/, 'Use letters, numbers, spaces, dots, dashes, underscores or brackets')
  .optional()
  .describe('Name for the upload as shown in your ZeroBounce dashboard (optional)');

const returnUrlSchema = z
  .string()
  .url()
  .max(2000)
  .optional()
  .describe('Webhook URL that ZeroBounce calls when processing finishes (optional)');

const localFileSchema = {
  file_path: z.string().min(1).optional().describe('Path to a local CSV or TXT file to upload (instead of a list or csv_content)'),
};

// =============================================================================
// Upload source handling
// =============================================================================

interface UploadSource {
  csv: string;
  fileName: string;
  hasHeaderRow: boolean;
  dataRows: number;
  columns: number;
  generated: boolean;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function ensureCsvName(name: string): string {
  return /\.(csv|txt)$/i.test(name) ? name : `${name}.csv`;
}

/**
 * Work out what to upload. Exactly one of: a generated list (already includes a
 * header row), csv_content, or file_path (CLI only).
 */
export async function resolveUpload(
  input: {
    generated?: string[][];
    csvContent?: string;
    filePath?: string;
    hasHeaderRow?: boolean;
    fileName?: string;
    service: FileService;
    listParam: string;
  },
  ctx: ToolContext,
): Promise<UploadSource> {
  const provided = [
    input.generated ? input.listParam : undefined,
    input.csvContent ? 'csv_content' : undefined,
    input.filePath ? 'file_path' : undefined,
  ].filter(Boolean);

  const options = ctx.allowLocalFiles ? `${input.listParam}, csv_content or file_path` : `${input.listParam} or csv_content`;
  if (provided.length === 0) throw new ToolInputError(`Provide the data to upload using ${options}.`);
  if (provided.length > 1) throw new ToolInputError(`Provide only one of ${options} (got ${provided.join(' and ')}).`);

  const defaultName = `mcp-${input.service.replace('_', '-')}-${timestamp()}.csv`;

  if (input.generated) {
    return {
      csv: toCsv(input.generated),
      fileName: ensureCsvName(input.fileName ?? defaultName),
      hasHeaderRow: true,
      dataRows: input.generated.length - 1,
      columns: input.generated[0]?.length ?? 0,
      generated: true,
    };
  }

  let content: string;
  let localName: string | undefined;
  if (input.filePath) {
    const file = await readLocalFile(input.filePath, ctx);
    content = file.content;
    localName = file.fileName;
  } else {
    content = input.csvContent as string;
  }

  const hasHeaderRow = input.hasHeaderRow ?? true;
  const rows = parseCsv(content);
  const dataRows = rows.length - (hasHeaderRow ? 1 : 0);
  if (dataRows < 1) throw new ToolInputError('The CSV has no data rows to upload.');

  return {
    csv: content,
    fileName: ensureCsvName(input.fileName ?? localName ?? defaultName),
    hasHeaderRow,
    dataRows,
    columns: rows.reduce((max, r) => Math.max(max, r.length), 0),
    generated: false,
  };
}

function checkColumns(source: UploadSource, columns: Record<string, number | undefined>): void {
  for (const [name, value] of Object.entries(columns)) {
    if (value !== undefined && value > source.columns) {
      throw new ToolInputError(`${name} is ${value}, but the CSV only has ${source.columns} column(s).`);
    }
  }
}

function submittedMessage(service: FileService, result: FileSubmitResult, source: UploadSource, maxCost: string): string {
  return [
    `## ${SERVICE_LABELS[service]} file submitted`,
    '',
    bullets([
      ['File ID', `\`${result.file_id}\``],
      ['File name', result.file_name ?? source.fileName],
      ['Rows uploaded', formatNumber(source.dataRows)],
      ['Maximum cost', maxCost],
    ]),
    '',
    `Next: call zerobounce_bulk_status with service "${service}" and file_id "${result.file_id}". ` +
      'When the status is Complete, call zerobounce_bulk_results to read the results.',
  ].join('\n');
}

// =============================================================================
// Submit tools
// =============================================================================

export const bulkValidate = defineTool({
  name: 'zerobounce_bulk_validate',
  title: 'Submit a list for bulk validation',
  group: 'Bulk files',
  description:
    'Upload a list of email addresses for bulk validation (for lists bigger than 100; use zerobounce_validate_batch for up to 100). ' +
    'Returns a file_id; processing runs in the background. Pass `emails`, or `csv_content` with email_address_column (and optionally name/gender/IP columns).',
  cost: '1 credit per email (duplicates and unknown results are not charged)',
  inputSchema: {
    emails: z.array(emailSchema).min(1).max(100_000).optional().describe('Email addresses to validate (alternative to csv_content)'),
    csv_content: csvContentSchema,
    email_address_column: column('the email address').describe('1-based column number of the email address in csv_content (default 1)'),
    first_name_column: column('the first name'),
    last_name_column: column('the last name'),
    gender_column: column('the gender'),
    ip_address_column: column('the signup IP address'),
    has_header_row: hasHeaderSchema,
    remove_duplicate: z
      .boolean()
      .optional()
      .describe('Remove duplicate emails before processing (ZeroBounce default: true). The upload fails if more than 50% of rows are duplicates.'),
    allow_phase_2: z
      .boolean()
      .optional()
      .describe('Run Verify+ phase 2 on catch-all results (applies when there are more than 10 catch-alls)'),
    return_url: returnUrlSchema,
    file_name: fileNameSchema,
  },
  localInputSchema: localFileSchema,
  annotations: SPENDS_CREDITS,
  async handler(args, ctx) {
    const generated = args.emails ? [['email'], ...args.emails.map(e => [e])] : undefined;
    const source = await resolveUpload(
      {
        generated,
        csvContent: args.csv_content,
        filePath: args.file_path,
        hasHeaderRow: args.has_header_row,
        fileName: args.file_name,
        service: 'validation',
        listParam: 'emails',
      },
      ctx,
    );

    const columns = source.generated
      ? { email_address_column: 1 }
      : {
          email_address_column: args.email_address_column ?? 1,
          first_name_column: args.first_name_column,
          last_name_column: args.last_name_column,
          gender_column: args.gender_column,
          ip_address_column: args.ip_address_column,
        };
    checkColumns(source, columns);

    const result = await ctx.getClient().sendFile('validation', source.csv, source.fileName, {
      ...columns,
      has_header_row: source.hasHeaderRow,
      remove_duplicate: args.remove_duplicate,
      allow_phase_2: args.allow_phase_2,
      return_url: args.return_url,
    });
    return textResult(submittedMessage('validation', result, source, `${formatNumber(source.dataRows)} credits`));
  },
});

export const bulkScore = defineTool({
  name: 'zerobounce_bulk_score',
  title: 'Submit a list for AI scoring',
  group: 'Bulk files',
  description:
    'Upload a list of email addresses for AI scoring (each gets a 0-10 quality score). Returns a file_id; processing runs in the background. ' +
    'Pass `emails`, or `csv_content` with email_address_column. Use zerobounce_score_email for a single address.',
  cost: '1 credit per email',
  inputSchema: {
    emails: z.array(emailSchema).min(1).max(100_000).optional().describe('Email addresses to score (alternative to csv_content)'),
    csv_content: csvContentSchema,
    email_address_column: column('the email address').describe('1-based column number of the email address in csv_content (default 1)'),
    has_header_row: hasHeaderSchema,
    remove_duplicate: z.boolean().optional().describe('Remove duplicate emails before processing (ZeroBounce default: true)'),
    return_url: returnUrlSchema,
    file_name: fileNameSchema,
  },
  localInputSchema: localFileSchema,
  annotations: SPENDS_CREDITS,
  async handler(args, ctx) {
    const generated = args.emails ? [['email'], ...args.emails.map(e => [e])] : undefined;
    const source = await resolveUpload(
      {
        generated,
        csvContent: args.csv_content,
        filePath: args.file_path,
        hasHeaderRow: args.has_header_row,
        fileName: args.file_name,
        service: 'scoring',
        listParam: 'emails',
      },
      ctx,
    );
    const columns = { email_address_column: source.generated ? 1 : args.email_address_column ?? 1 };
    checkColumns(source, columns);

    const result = await ctx.getClient().sendFile('scoring', source.csv, source.fileName, {
      ...columns,
      has_header_row: source.hasHeaderRow,
      remove_duplicate: args.remove_duplicate,
      return_url: args.return_url,
    });
    return textResult(submittedMessage('scoring', result, source, `${formatNumber(source.dataRows)} credits`));
  },
});

const contactSchema = z.object({
  first_name: z.string().trim().min(1).max(100).describe('First name'),
  last_name: z.string().trim().max(100).optional().describe('Last name'),
  middle_name: z.string().trim().max(100).optional().describe('Middle name'),
  domain: z.string().trim().min(3).max(253).describe('Company email domain, e.g. "acme.com"'),
});

export const bulkFindEmails = defineTool({
  name: 'zerobounce_bulk_find_emails',
  title: 'Submit contacts to find their emails',
  group: 'Bulk files',
  description:
    'Find email addresses for many people at once. Pass `contacts` (first name, optional last/middle name, company domain), ' +
    'or `csv_content` with domain_column plus first_name_column (or full_name_column). Returns a file_id; processing runs in the background.',
  cost: '20 credits per address found (or 1 query on an Email Finder subscription); nothing charged for contacts not found',
  inputSchema: {
    contacts: z.array(contactSchema).min(1).max(10_000).optional().describe('People to look up (alternative to csv_content)'),
    csv_content: csvContentSchema,
    domain_column: column('the company domain'),
    first_name_column: column('the first name'),
    last_name_column: column('the last name'),
    middle_name_column: column('the middle name'),
    full_name_column: column('the full name (use instead of first/last name columns)'),
    has_header_row: hasHeaderSchema,
    file_name: fileNameSchema,
  },
  localInputSchema: localFileSchema,
  annotations: SPENDS_CREDITS,
  async handler(args, ctx) {
    let generated: string[][] | undefined;
    let generatedColumns: Record<string, number> = {};
    if (args.contacts) {
      // Only include optional columns that actually have data.
      const withLast = args.contacts.some(c => c.last_name);
      const withMiddle = args.contacts.some(c => c.middle_name);
      const header = ['first_name', ...(withLast ? ['last_name'] : []), ...(withMiddle ? ['middle_name'] : []), 'domain'];
      generated = [header, ...args.contacts.map(c => [c.first_name, ...(withLast ? [c.last_name ?? ''] : []), ...(withMiddle ? [c.middle_name ?? ''] : []), c.domain])];
      generatedColumns = Object.fromEntries(header.map((h, i) => [`${h}_column`, i + 1]));
    }

    const source = await resolveUpload(
      {
        generated,
        csvContent: args.csv_content,
        filePath: args.file_path,
        hasHeaderRow: args.has_header_row,
        fileName: args.file_name,
        service: 'email_finder',
        listParam: 'contacts',
      },
      ctx,
    );

    let columns: Record<string, number | undefined>;
    if (source.generated) {
      columns = generatedColumns;
    } else {
      if (!args.domain_column) throw new ToolInputError('domain_column is required when uploading csv_content or a file.');
      if (!args.first_name_column && !args.full_name_column) {
        throw new ToolInputError('Provide first_name_column or full_name_column when uploading csv_content or a file.');
      }
      columns = {
        domain_column: args.domain_column,
        first_name_column: args.first_name_column,
        last_name_column: args.last_name_column,
        middle_name_column: args.middle_name_column,
        full_name_column: args.full_name_column,
      };
    }
    checkColumns(source, columns);

    const result = await ctx.getClient().sendFile('email_finder', source.csv, source.fileName, {
      ...columns,
      has_header_row: source.hasHeaderRow,
    });
    return textResult(
      submittedMessage('email_finder', result, source, `${formatNumber(source.dataRows * 20)} credits if every address is found`),
    );
  },
});

export const bulkDomainSearch = defineTool({
  name: 'zerobounce_bulk_domain_search',
  title: 'Submit domains to find their email formats',
  group: 'Bulk files',
  description:
    'Find the email format (e.g. first.last) for many company domains at once. Pass `domains`, or `csv_content` with domain_column. ' +
    'Returns a file_id; processing runs in the background.',
  cost: '20 credits per format found (or 1 query on an Email Finder subscription); nothing charged for domains not found',
  inputSchema: {
    domains: z.array(z.string().trim().min(3).max(253)).min(1).max(10_000).optional().describe('Company domains (alternative to csv_content)'),
    csv_content: csvContentSchema,
    domain_column: column('the domain').describe('1-based column number of the domain in csv_content (default 1)'),
    has_header_row: hasHeaderSchema,
    file_name: fileNameSchema,
  },
  localInputSchema: localFileSchema,
  annotations: SPENDS_CREDITS,
  async handler(args, ctx) {
    const generated = args.domains ? [['domain'], ...args.domains.map(d => [d])] : undefined;
    const source = await resolveUpload(
      {
        generated,
        csvContent: args.csv_content,
        filePath: args.file_path,
        hasHeaderRow: args.has_header_row,
        fileName: args.file_name,
        service: 'domain_search',
        listParam: 'domains',
      },
      ctx,
    );
    const columns = { domain_column: source.generated ? 1 : args.domain_column ?? 1 };
    checkColumns(source, columns);

    const result = await ctx.getClient().sendFile('domain_search', source.csv, source.fileName, {
      ...columns,
      has_header_row: source.hasHeaderRow,
    });
    return textResult(
      submittedMessage('domain_search', result, source, `${formatNumber(source.dataRows * 20)} credits if every format is found`),
    );
  },
});

// =============================================================================
// Status
// =============================================================================

export function formatFileStatus(service: FileService, status: FileStatusResult, fileId: string): string {
  const state = String(status.file_status ?? 'Unknown');
  const complete = /^complete$/i.test(state);
  const phase2 = hasValue(status.file_phase_2_status) && status.file_phase_2_status !== 'N/A' ? status.file_phase_2_status : undefined;

  let next: string;
  if (complete) {
    next = `Ready. Call zerobounce_bulk_results with service "${service}" and file_id "${fileId}".`;
  } else if (/fail|deleted/i.test(state)) {
    next = 'This file will not produce results. Check the error above, fix the input, and submit it again.';
  } else {
    next = 'Still processing. Check again in a minute or two (large files can take longer).';
  }

  return [
    `## ${SERVICE_LABELS[service]}: ${status.file_name ?? fileId}`,
    '',
    bullets([
      ['File ID', `\`${status.file_id ?? fileId}\``],
      ['Status', `${state}${hasValue(status.complete_percentage) ? ` (${status.complete_percentage})` : ''}`],
      ['Phase 2 (catch-all) status', phase2],
      ['Uploaded', status.upload_date],
      ['Error', status.error_reason],
      ['Webhook', status.return_url],
    ]),
    '',
    next,
  ].join('\n');
}

export const bulkStatus = defineTool({
  name: 'zerobounce_bulk_status',
  title: 'Check a bulk file status',
  group: 'Bulk files',
  description: 'Check the processing status and progress of a bulk file (validation, scoring, email_finder or domain_search).',
  cost: 'Free',
  inputSchema: { service: serviceSchema, file_id: fileIdSchema, response_format: responseFormatSchema },
  annotations: READ_ONLY,
  async handler({ service, file_id, response_format }, ctx) {
    const status = await ctx.getClient().fileStatus(service, file_id);
    return response_format === 'json' ? jsonResult(status) : textResult(formatFileStatus(service, status, file_id));
  },
});

// =============================================================================
// Results (with a small, bounded, per-user cache)
// =============================================================================

interface ParsedResults {
  headers: string[];
  rows: string[][];
  fileName?: string;
  bytes: number;
  expiresAt: number;
}

const RESULT_CACHE_TTL_MS = 10 * 60_000;
const RESULT_CACHE_MAX_ENTRIES = 10;
// Parsed rows take roughly 5x the CSV size in memory (measured: 50 MB CSV ≈ 230 MB heap),
// so the budget is on that estimate, not on raw bytes.
const PARSED_SIZE_FACTOR = 5;
const RESULT_CACHE_MAX_MEMORY = 120 * 1024 * 1024;
const resultCache = new Map<string, ParsedResults>();
// Concurrent requests for the same file share one download + parse.
const pendingLoads = new Map<string, Promise<ParsedResults>>();

export function clearResultCache(): void {
  resultCache.clear();
}

function pruneResultCache(): void {
  const now = Date.now();
  for (const [key, entry] of resultCache) if (entry.expiresAt <= now) resultCache.delete(key);
  let total = [...resultCache.values()].reduce((sum, e) => sum + e.bytes * PARSED_SIZE_FACTOR, 0);
  // Map keeps insertion order, so the first key is the oldest. The newest entry is
  // always kept (it's being returned to the caller anyway).
  while (resultCache.size > 1 && (resultCache.size > RESULT_CACHE_MAX_ENTRIES || total > RESULT_CACHE_MAX_MEMORY)) {
    const oldest = resultCache.keys().next().value as string;
    total -= (resultCache.get(oldest)?.bytes ?? 0) * PARSED_SIZE_FACTOR;
    resultCache.delete(oldest);
  }
}

async function loadResults(
  client: ZeroBounceClient,
  service: FileService,
  fileId: string,
  options: { downloadType?: 'phase_1' | 'phase_2' | 'combined'; activityData?: boolean },
): Promise<ParsedResults> {
  const key = [client.keyFingerprint, service, fileId, options.downloadType ?? '', options.activityData ? 1 : 0].join(':');
  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const inflight = pendingLoads.get(key);
  if (inflight) return inflight;

  const load = (async () => {
    const file = await client.getFile(service, fileId, options);
    const all = parseCsv(file.csv);
    const parsed: ParsedResults = {
      headers: all[0] ?? [],
      rows: all.slice(1),
      fileName: file.fileName,
      bytes: file.bytes,
      expiresAt: Date.now() + RESULT_CACHE_TTL_MS,
    };
    resultCache.delete(key);
    resultCache.set(key, parsed);
    pruneResultCache();
    return parsed;
  })();

  pendingLoads.set(key, load);
  try {
    return await load;
  } finally {
    pendingLoads.delete(key);
  }
}

function findColumn(headers: string[], patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const index = headers.findIndex(h => pattern.test(h.trim()));
    if (index >= 0) return index;
  }
  return -1;
}

function countBy(rows: string[][], index: number): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = (row[index] ?? '').trim() || '(blank)';
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function pct(count: number, total: number): string {
  return total ? `${((count / total) * 100).toFixed(1)}%` : '0%';
}

/** Build the per-service summary (markdown + structured data for JSON output). */
export function summariseResults(service: FileService, data: { headers: string[]; rows: string[][] }) {
  const { headers, rows } = data;
  const total = rows.length;
  const sections: string[] = [];
  const summary: Record<string, unknown> = { total_rows: total, columns: headers };

  if (service === 'validation') {
    const statusCol = findColumn(headers, [/^zb status$/i, /(^|\s)status$/i]);
    const subCol = findColumn(headers, [/^zb sub ?status$/i, /sub.?status/i]);
    if (statusCol >= 0) {
      const byStatus = countBy(rows, statusCol);
      const verdicts = new Map<Verdict, number>();
      for (const [status, count] of byStatus) {
        const { verdict } = describeStatus(status);
        verdicts.set(verdict, (verdicts.get(verdict) ?? 0) + count);
      }
      summary.by_status = Object.fromEntries(byStatus);
      summary.by_verdict = Object.fromEntries(verdicts);
      sections.push(
        '### By status',
        table(['Status', 'Verdict', 'Count', 'Share'], byStatus.map(([s, c]) => [s, describeStatus(s).verdict, formatNumber(c), pct(c, total)])),
      );
    }
    if (subCol >= 0) {
      const bySub = countBy(rows, subCol).filter(([s]) => s !== '(blank)');
      summary.by_sub_status = Object.fromEntries(bySub);
      if (bySub.length) {
        sections.push('', '### Top sub-statuses', table(['Sub-status', 'Count'], bySub.slice(0, 10).map(([s, c]) => [s, formatNumber(c)])));
      }
    }
  } else if (service === 'scoring') {
    const scoreCol = findColumn(headers, [/score/i]);
    if (scoreCol >= 0) {
      const scores = rows.map(r => Number(r[scoreCol])).filter(n => Number.isFinite(n));
      const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      const byScore = countBy(rows, scoreCol).sort((a, b) => Number(b[0]) - Number(a[0]));
      summary.average_score = Number(average.toFixed(2));
      summary.by_score = Object.fromEntries(byScore);
      sections.push(
        `**Average score:** ${average.toFixed(1)} / 10`,
        '',
        table(['Score', 'Count', 'Share'], byScore.map(([s, c]) => [s, formatNumber(c), pct(c, total)])),
      );
      if (scores.some(s => s === 0)) {
        sections.push('', 'ZeroBounce recommends not mailing addresses that score 0 (very low predicted engagement, not necessarily invalid).');
      }
    }
  } else {
    const confidenceCol = findColumn(headers, [/confidence/i]);
    if (service === 'email_finder') {
      const emailCol = findColumn(headers, [/^(zb )?email$/i, /^(?!.*confidence).*email/i]);
      if (emailCol >= 0) {
        const found = rows.filter(r => (r[emailCol] ?? '').includes('@')).length;
        summary.found = found;
        summary.not_found = total - found;
        sections.push(`**Emails found:** ${formatNumber(found)} of ${formatNumber(total)} (${pct(found, total)})`);
      }
    } else {
      const formatCol = findColumn(headers, [/^(zb )?format$/i, /format/i]);
      if (formatCol >= 0) {
        const byFormat = countBy(rows, formatCol);
        summary.by_format = Object.fromEntries(byFormat);
        sections.push('### Formats', table(['Format', 'Count'], byFormat.slice(0, 10).map(([f, c]) => [f, formatNumber(c)])));
      }
    }
    if (confidenceCol >= 0) {
      const byConfidence = countBy(rows, confidenceCol);
      summary.by_confidence = Object.fromEntries(byConfidence);
      sections.push('', '### By confidence', table(['Confidence', 'Count'], byConfidence.map(([c, n]) => [c.toLowerCase(), formatNumber(n)])));
    }
  }

  return { summary, sections };
}

/** Columns shown in the rows view when the caller doesn't choose. */
function defaultColumns(service: FileService, headers: string[]): number[] {
  if (service === 'validation') {
    const picks = [
      0,
      findColumn(headers, [/^zb status$/i]),
      findColumn(headers, [/^zb sub ?status$/i]),
      findColumn(headers, [/^zb did you mean$/i]),
      findColumn(headers, [/^zb free email$/i]),
    ].filter(i => i >= 0);
    return [...new Set(picks)];
  }
  return headers.slice(0, 10).map((_, i) => i);
}

export const bulkResults = defineTool({
  name: 'zerobounce_bulk_results',
  title: 'Read bulk file results',
  group: 'Bulk files',
  description:
    'Read the results of a completed bulk file. view="summary" (default) gives counts (by status/verdict, score, found rate or format); ' +
    'view="rows" returns one page of rows. Use `filter` to keep rows where any column equals a value (e.g. "valid", "catch-all", "do_not_mail", "high"). ' +
    'Results are not dumped in full: page through with offset/limit.',
  cost: 'Free',
  inputSchema: {
    service: serviceSchema,
    file_id: fileIdSchema,
    view: z.enum(['summary', 'rows']).default('summary').describe('"summary" (default) or "rows"'),
    filter: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('Only include rows where some column equals this value (case-insensitive), e.g. "valid" or "do_not_mail"'),
    columns: z
      .array(z.string().trim().min(1))
      .max(30)
      .optional()
      .describe('Column names to show in the rows view (defaults to the most useful ones)'),
    offset: z.number().int().min(0).default(0).describe('Rows to skip (rows view)'),
    limit: z.number().int().min(1).max(500).default(25).describe('Rows to return (rows view, 1-500, default 25)'),
    download_type: z
      .enum(['phase_1', 'phase_2', 'combined'])
      .optional()
      .describe('Validation only: which results to download when Verify+ phase 2 was used (phase_2/combined need phase 2 to be complete)'),
    activity_data: z.boolean().optional().describe('Validation only: append Activity Data columns'),
    response_format: responseFormatSchema,
  },
  localInputSchema: {
    save_to_path: z.string().min(1).optional().describe('Also save the full results CSV to this local path'),
  },
  annotations: READ_ONLY,
  async handler(args, ctx) {
    const client = ctx.getClient();
    const options = {
      downloadType: args.service === 'validation' ? args.download_type : undefined,
      activityData: args.service === 'validation' ? args.activity_data : undefined,
    };

    let savedTo: string | undefined;
    if (args.save_to_path) {
      const file = await client.getFile(args.service, args.file_id, options);
      savedTo = await writeLocalFile(args.save_to_path, file.csv, ctx);
    }

    const data = await loadResults(client, args.service, args.file_id, options);
    const filterValue = args.filter?.toLowerCase();
    const rows = filterValue ? data.rows.filter(r => r.some(c => c.trim().toLowerCase() === filterValue)) : data.rows;
    const title = `${SERVICE_LABELS[args.service]} results: ${data.fileName ?? args.file_id}`;
    const filterNote = filterValue ? ` matching "${args.filter}"` : '';

    if (args.view === 'summary') {
      const { summary, sections } = summariseResults(args.service, { headers: data.headers, rows });
      if (args.response_format === 'json') return jsonResult({ file_id: args.file_id, service: args.service, filter: args.filter, saved_to: savedTo, ...summary });
      return textResult(
        [
          `## ${title}`,
          '',
          `**Rows${filterNote}:** ${formatNumber(rows.length)}${filterValue ? ` of ${formatNumber(data.rows.length)}` : ''}`,
          `**Columns:** ${data.headers.join(', ')}`,
          ...(savedTo ? [`**Saved full CSV to:** ${savedTo}`] : []),
          '',
          ...sections,
          '',
          'Use view="rows" (optionally with filter, offset and limit) to see individual rows.',
        ].join('\n'),
      );
    }

    // Rows view
    let columnIndexes: number[];
    if (args.columns?.length) {
      columnIndexes = args.columns.map(name => {
        const index = data.headers.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());
        if (index < 0) throw new ToolInputError(`Unknown column "${name}". Available columns: ${data.headers.join(', ')}`);
        return index;
      });
    } else {
      columnIndexes = defaultColumns(args.service, data.headers);
    }

    const page = rows.slice(args.offset, args.offset + args.limit);
    const headers = columnIndexes.map(i => data.headers[i]);

    if (args.response_format === 'json') {
      return jsonResult({
        file_id: args.file_id,
        service: args.service,
        total_rows: rows.length,
        offset: args.offset,
        limit: args.limit,
        saved_to: savedTo,
        rows: page.map(r => Object.fromEntries(data.headers.map((h, i) => [h, r[i] ?? '']))),
      });
    }

    if (!page.length) {
      return textResult(`## ${title}\n\nNo rows${filterNote} at offset ${args.offset} (total: ${formatNumber(rows.length)}).`);
    }

    const end = args.offset + page.length;
    const lines = [
      `## ${title}`,
      '',
      `Rows ${formatNumber(args.offset + 1)}-${formatNumber(end)} of ${formatNumber(rows.length)}${filterNote}`,
      '',
      table(headers, page.map(r => columnIndexes.map(i => r[i] ?? ''))),
    ];
    if (end < rows.length) lines.push('', `More rows available: call again with offset=${end}.`);
    if (!args.columns?.length && headers.length < data.headers.length) {
      lines.push('', `Other columns: ${data.headers.filter((_, i) => !columnIndexes.includes(i)).join(', ')} (pick them with \`columns\`).`);
    }
    if (savedTo) lines.push('', `Saved full CSV to: ${savedTo}`);
    return textResult(lines.join('\n'));
  },
});

// =============================================================================
// Delete
// =============================================================================

export const bulkDelete = defineTool({
  name: 'zerobounce_bulk_delete',
  title: 'Delete a bulk file',
  group: 'Bulk files',
  description:
    "Permanently delete a bulk file and its results from ZeroBounce. Only works once the file's status is Complete. Download anything you need first.",
  cost: 'Free',
  inputSchema: { service: serviceSchema, file_id: fileIdSchema },
  annotations: DESTRUCTIVE,
  async handler({ service, file_id }, ctx) {
    const client = ctx.getClient();
    const result = await client.deleteFile(service, file_id);
    // Drop any cached copy of this file's results.
    for (const key of resultCache.keys()) {
      if (key.startsWith(`${client.keyFingerprint}:${service}:${file_id}:`)) resultCache.delete(key);
    }
    return textResult(`${result.message ?? 'File deleted'}: ${result.file_name ?? file_id} (\`${file_id}\`)`);
  },
});

export const bulkTools = [bulkValidate, bulkScore, bulkFindEmails, bulkDomainSearch, bulkStatus, bulkResults, bulkDelete];
