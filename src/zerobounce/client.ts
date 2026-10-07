/**
 * ZeroBounce API client.
 *
 * - One client per request: the API key lives only inside this object
 *   (never in process.env or any shared/global state).
 * - Uses Node's built-in fetch / FormData / Blob (no axios, no form-data).
 * - Real-time endpoints are called with POST + form body so the API key stays
 *   out of URLs (supported by ZeroBounce since 3 Sep 2026). Bulk endpoints only
 *   support GET with a query string, so those still send the key in the URL.
 * - Every error goes through errors.ts so tools get one consistent error type.
 */

import { createHash } from 'node:crypto';
import {
  ZeroBounceError,
  errorFromApiMessage,
  errorFromHttpStatus,
  extractApiError,
  scrubSecret,
} from './errors.js';
import { BULK_HOST, REALTIME_HOSTS, type ZeroBounceRegion } from './regions.js';
import type {
  ActivityResult,
  ApiUsage,
  BatchResult,
  FileStatusResult,
  FileSubmitResult,
  FilterRule,
  GuessFormatResult,
  ListEvaluatorResult,
  ScoreResult,
  ValidateResult,
} from './types.js';

import { SERVER_VERSION as CLIENT_VERSION } from '../version.js';
export { CLIENT_VERSION };

/** Bulk/file services that share the sendfile → filestatus → getfile → deletefile flow. */
export type FileService = 'validation' | 'scoring' | 'email_finder' | 'domain_search';

export const FILE_SERVICES: readonly FileService[] = ['validation', 'scoring', 'email_finder', 'domain_search'];

const FILE_SERVICE_PATHS: Record<FileService, string> = {
  validation: '/v2',
  scoring: '/v2/scoring',
  email_finder: '/email-finder',
  domain_search: '/domain-search',
};

/** Default largest result file we will download and parse in memory (overridable per client). */
export const MAX_RESULT_FILE_BYTES = 50 * 1024 * 1024;

/** JSON responses are small; this is only a safety net. */
const MAX_JSON_BYTES = 10 * 1024 * 1024;

function isAbortOrTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function tooLargeError(maxBytes: number): ZeroBounceError {
  return new ZeroBounceError(
    'api_error',
    `The results file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, which is too large to process here. ` +
      'Download it from the ZeroBounce dashboard instead.',
  );
}

type ParamValue = string | number | boolean | null | undefined;
type Params = Record<string, ParamValue>;

interface RequestOptions {
  /** HTTP timeout in milliseconds. */
  timeoutMs?: number;
  /** Retry once on network/5xx errors. Only used for free, read-only calls. */
  retry?: boolean;
  /** Treat a bare {"Message": "..."} body as an error (guessformat). */
  messageIsError?: boolean;
}

export interface ZeroBounceClientOptions {
  apiKey: string;
  region?: ZeroBounceRegion;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Delay before the single retry (ms). Tests set this to 0. */
  retryDelayMs?: number;
  /** Largest bulk results file to download (bytes). */
  maxResultBytes?: number;
}

export interface ValidateParams {
  email: string;
  ipAddress?: string;
  timeout?: number;
  activityData?: boolean;
  verifyPlus?: boolean;
  domainInfo?: boolean;
}

export interface BatchParams {
  emails: Array<{ email: string; ipAddress?: string }>;
  timeout?: number;
  activityData?: boolean;
  verifyPlus?: boolean;
}

export interface GuessFormatParams {
  domain?: string;
  companyName?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
}

export interface DownloadedFile {
  csv: string;
  fileName?: string;
  bytes: number;
}

/** Convert parameter values to the strings ZeroBounce expects (booleans → "true"/"false"). */
function toParamStrings(params: Params): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = String(value);
  }
  return out;
}

function snippet(text: string, max = 200): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** File IDs are UUID-like. Validating them keeps them safe to put in a URL path. */
export function assertFileId(fileId: string): string {
  const trimmed = fileId.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(trimmed)) {
    throw new ZeroBounceError('bad_request', `"${fileId}" is not a valid ZeroBounce file ID.`);
  }
  return trimmed;
}

export class ZeroBounceClient {
  readonly region: ZeroBounceRegion;
  /** Non-reversible ID for this key, used to keep per-user caches separate. */
  readonly keyFingerprint: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retryDelayMs: number;
  private readonly maxResultBytes: number;

  constructor(options: ZeroBounceClientOptions) {
    if (!options.apiKey || !options.apiKey.trim()) {
      throw new ZeroBounceError('auth', 'No ZeroBounce API key was provided.');
    }
    this.apiKey = options.apiKey.trim();
    this.keyFingerprint = createHash('sha256').update(this.apiKey).digest('hex').slice(0, 16);
    this.region = options.region ?? 'default';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.maxResultBytes = options.maxResultBytes ?? MAX_RESULT_FILE_BYTES;
  }

  private get realtimeBase(): string {
    return REALTIME_HOSTS[this.region];
  }

  // ===========================================================================
  // Account
  // ===========================================================================

  /** GET credit balance. Free. */
  async getCredits(): Promise<number> {
    const body = await this.realtimePost<{ Credits: number | string }>('/getcredits', {}, { retry: true });
    const credits = Number(body.Credits);
    if (!Number.isFinite(credits)) {
      throw new ZeroBounceError('api_error', 'ZeroBounce returned an unexpected credit balance.');
    }
    return credits;
  }

  /** API usage between two dates (yyyy-mm-dd). Free. */
  async getApiUsage(startDate: string, endDate: string): Promise<ApiUsage> {
    return this.realtimePost<ApiUsage>('/getapiusage', { start_date: startDate, end_date: endDate }, { retry: true });
  }

  // ===========================================================================
  // Validation
  // ===========================================================================

  /** Validate one email. 1 credit (unknown results are refunded). */
  async validate(params: ValidateParams): Promise<ValidateResult> {
    const apiTimeout = params.timeout ?? 30;
    return this.realtimePost<ValidateResult>(
      '/validate',
      {
        email: params.email,
        ip_address: params.ipAddress ?? '',
        timeout: params.timeout,
        activity_data: params.activityData,
        verify_plus: params.verifyPlus,
        domain_info: params.domainInfo,
      },
      // Give the HTTP request more time than ZeroBounce's own validation timeout.
      { timeoutMs: (apiTimeout + 20) * 1000 },
    );
  }

  /** Validate up to 100 emails in one request. 1 credit per email. */
  async validateBatch(params: BatchParams): Promise<BatchResult> {
    const payload = {
      api_key: this.apiKey,
      email_batch: params.emails.map(item => ({
        email_address: item.email,
        ip_address: item.ipAddress ?? null,
      })),
      ...(params.timeout !== undefined ? { timeout: params.timeout } : {}),
      ...(params.activityData !== undefined ? { activity_data: params.activityData } : {}),
      ...(params.verifyPlus !== undefined ? { verify_plus: params.verifyPlus } : {}),
    };

    const res = await this.send(
      `${this.realtimeBase}/validatebatch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      },
      // Batches can take up to ~70s on ZeroBounce's side.
      { timeoutMs: ((params.timeout ?? 60) + 70) * 1000 },
    );
    const body = (await this.readJson(res)) as Partial<BatchResult>;

    const errors = Array.isArray(body.errors) ? body.errors : [];
    // An error for "all" means the whole batch failed (bad key / no credits).
    const fatal = errors.find(e => e && e.email_address === 'all');
    if (fatal) throw errorFromApiMessage(this.scrub(String(fatal.error)), res.status);

    return {
      email_batch: Array.isArray(body.email_batch) ? body.email_batch : [],
      errors,
    };
  }

  /** Activity data for one email. Free when nothing is found. */
  async getActivity(email: string): Promise<ActivityResult> {
    return this.realtimePost<ActivityResult>('/activity', { email });
  }

  /** AI score (0-10) for one email. 1 credit. */
  async scoreEmail(email: string): Promise<ScoreResult> {
    return this.realtimePost<ScoreResult>('/scoring', { email });
  }

  // ===========================================================================
  // Email Finder / Domain Search (same endpoint: /v2/guessformat)
  // ===========================================================================

  /** 20 credits per successful result; nothing charged when undetermined. */
  async guessFormat(params: GuessFormatParams): Promise<GuessFormatResult> {
    return this.realtimePost<GuessFormatResult>(
      '/guessformat',
      {
        domain: params.domain,
        company_name: params.companyName,
        first_name: params.firstName,
        middle_name: params.middleName,
        last_name: params.lastName,
      },
      { messageIsError: true },
    );
  }

  // ===========================================================================
  // Allow / block filters
  // ===========================================================================

  async listFilters(): Promise<FilterRule[]> {
    const body = await this.realtimePost<unknown>('/filters/list', {}, { retry: true });
    if (Array.isArray(body)) return body as FilterRule[];
    // Be tolerant of a wrapped response shape.
    const wrapped = (body as Record<string, unknown>)?.filters;
    return Array.isArray(wrapped) ? (wrapped as FilterRule[]) : [];
  }

  async addFilter(rule: FilterRule): Promise<string> {
    const body = await this.realtimePost<Record<string, unknown>>('/filters/add', { ...rule });
    return String(body.Message ?? body.message ?? 'Filter saved');
  }

  async deleteFilter(rule: FilterRule): Promise<string> {
    const body = await this.realtimePost<Record<string, unknown>>('/filters/delete', { ...rule });
    const message = String(body.Message ?? body.message ?? 'Filter deleted');
    // ZeroBounce reports "Filter does not exist" in the same shape as success; nothing was deleted.
    if (/does not exist/i.test(message)) {
      throw new ZeroBounceError(
        'not_found',
        `No ${rule.rule} filter exists for ${rule.target} "${rule.value}". Use zerobounce_list_filters to see the exact rules.`,
      );
    }
    return message;
  }

  // ===========================================================================
  // Bulk files (validation, AI scoring, email finder, domain search)
  // ===========================================================================

  /** Upload a CSV for bulk processing. Fields are service-specific (see tools/bulk.ts). */
  async sendFile(service: FileService, csv: string, fileName: string, fields: Params): Promise<FileSubmitResult> {
    const url = `${BULK_HOST}${FILE_SERVICE_PATHS[service]}/sendfile`;
    const body = await this.multipartPost<FileSubmitResult>(url, csv, fileName, fields);
    if (!body.file_id) {
      throw new ZeroBounceError('api_error', 'ZeroBounce accepted the upload but did not return a file ID.');
    }
    return body;
  }

  async fileStatus(service: FileService, fileId: string): Promise<FileStatusResult> {
    const url = `${BULK_HOST}${FILE_SERVICE_PATHS[service]}/filestatus`;
    return this.bulkGetJson<FileStatusResult>(url, { file_id: assertFileId(fileId) }, { retry: true });
  }

  async deleteFile(service: FileService, fileId: string): Promise<FileSubmitResult> {
    const url = `${BULK_HOST}${FILE_SERVICE_PATHS[service]}/deletefile`;
    return this.bulkGetJson<FileSubmitResult>(url, { file_id: assertFileId(fileId) });
  }

  /** Download a finished results file (CSV). Free. */
  async getFile(
    service: FileService,
    fileId: string,
    options: { downloadType?: 'phase_1' | 'phase_2' | 'combined'; activityData?: boolean } = {},
  ): Promise<DownloadedFile> {
    const url = new URL(`${BULK_HOST}${FILE_SERVICE_PATHS[service]}/getfile`);
    const query = toParamStrings({
      api_key: this.apiKey,
      file_id: assertFileId(fileId),
      download_type: service === 'validation' ? options.downloadType : undefined,
      activity_data: service === 'validation' ? options.activityData : undefined,
    });
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

    const res = await this.send(url.toString(), { method: 'GET' }, { timeoutMs: 120_000, retry: true });

    // Reject early when the size is declared; readText also enforces the cap while
    // streaming, for responses without a Content-Length (chunked).
    const declaredLength = Number(res.headers.get('content-length') || 0);
    if (declaredLength > this.maxResultBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw tooLargeError(this.maxResultBytes);
    }

    const contentType = res.headers.get('content-type') || '';
    const text = await this.readText(res, this.maxResultBytes);

    if (!res.ok) this.throwForResponse(res.status, text);

    // ZeroBounce sometimes returns a JSON error with HTTP 200 instead of a file.
    if (contentType.includes('json') || /^\s*[{[]/.test(text)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      if (parsed !== undefined) {
        const message = extractApiError(parsed, { messageIsError: true });
        throw message
          ? errorFromApiMessage(this.scrub(message), res.status)
          : new ZeroBounceError('api_error', 'ZeroBounce returned JSON instead of the results file. The file may not be ready yet.');
      }
    }
    if (/^\s*<(!doctype|html)/i.test(text)) {
      throw errorFromHttpStatus(403, '');
    }

    const disposition = res.headers.get('content-disposition') || '';
    const fileName = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
    return { csv: text, fileName, bytes: Buffer.byteLength(text) };
  }

  // ===========================================================================
  // List Evaluator (free)
  // ===========================================================================

  async evaluateList(csv: string, fileName: string, emailAddressColumn: number): Promise<ListEvaluatorResult> {
    // The trailing slash matters: ZeroBounce's firewall rejects paths that differ from the docs.
    return this.multipartPost<ListEvaluatorResult>(`${BULK_HOST}/v2/listevaluator/`, csv, fileName, {
      email_address_column: emailAddressColumn,
    });
  }

  async evaluateListStatus(fileId: string): Promise<ListEvaluatorResult> {
    const id = encodeURIComponent(assertFileId(fileId));
    return this.bulkGetJson<ListEvaluatorResult>(`${BULK_HOST}/v2/listevaluator/${id}/`, {}, { retry: true });
  }

  // ===========================================================================
  // Low-level helpers
  // ===========================================================================

  /** POST application/x-www-form-urlencoded to a real-time endpoint (key in body, not URL). */
  private async realtimePost<T>(path: string, params: Params, options: RequestOptions = {}): Promise<T> {
    const form = new URLSearchParams(toParamStrings({ api_key: this.apiKey, ...params }));
    const res = await this.send(
      `${this.realtimeBase}${path}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: form.toString(),
      },
      options,
    );
    return (await this.readJson(res, options)) as T;
  }

  /** GET a bulk endpoint that returns JSON (the bulk API has no POST variant). */
  private async bulkGetJson<T>(baseUrl: string, params: Params, options: RequestOptions = {}): Promise<T> {
    const url = new URL(baseUrl);
    for (const [k, v] of Object.entries(toParamStrings({ api_key: this.apiKey, ...params }))) {
      url.searchParams.set(k, v);
    }
    const res = await this.send(url.toString(), { method: 'GET', headers: { Accept: 'application/json' } }, options);
    return (await this.readJson(res, options)) as T;
  }

  /** multipart/form-data upload of an in-memory CSV. */
  private async multipartPost<T>(url: string, csv: string, fileName: string, fields: Params): Promise<T> {
    const form = new FormData();
    form.append('api_key', this.apiKey);
    for (const [k, v] of Object.entries(toParamStrings(fields))) form.append(k, v);
    form.append('file', new Blob([csv], { type: 'text/csv' }), fileName);

    const res = await this.send(url, { method: 'POST', body: form, headers: { Accept: 'application/json' } }, {
      timeoutMs: 120_000,
    });
    return (await this.readJson(res)) as T;
  }

  /** fetch with timeout, User-Agent and (optionally) one retry on transient failures. */
  private async send(url: string, init: RequestInit, options: RequestOptions = {}): Promise<Response> {
    const attempts = options.retry ? 2 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          ...init,
          headers: { 'User-Agent': `mcp-zerobounce/${CLIENT_VERSION}`, ...(init.headers as Record<string, string>) },
          signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        });
        // Retry transient server errors (never 429 — retrying extends ZeroBounce's block).
        if (attempt < attempts && [500, 502, 503, 520, 524].includes(res.status)) {
          lastError = errorFromHttpStatus(res.status);
          await res.body?.cancel().catch(() => undefined); // free the connection
          await sleep(this.retryDelayMs);
          continue;
        }
        return res;
      } catch (error) {
        lastError = error;
        if (isAbortOrTimeout(error)) throw this.toTransportError(error);
        if (attempt < attempts) {
          await sleep(this.retryDelayMs);
          continue;
        }
      }
    }

    if (lastError instanceof ZeroBounceError) throw lastError;
    throw this.toTransportError(lastError);
  }

  /** Map fetch/stream failures (timeouts, resets) to a friendly ZeroBounceError. */
  private toTransportError(error: unknown): ZeroBounceError {
    if (error instanceof ZeroBounceError) return error;
    if (isAbortOrTimeout(error)) {
      return new ZeroBounceError('timeout', 'ZeroBounce did not respond in time. Try again, or use a shorter timeout.');
    }
    const detail = error instanceof Error ? error.message : String(error);
    return new ZeroBounceError('network', `Could not reach ZeroBounce: ${this.scrub(detail)}`);
  }

  /**
   * Read a response body as text. The request's timeout also covers reading the
   * body, so errors here get the same timeout/network mapping. Optionally stops
   * reading once `maxBytes` is exceeded (for responses without Content-Length).
   */
  private async readText(res: Response, maxBytes: number): Promise<string> {
    try {
      if (!res.body) return await res.text();
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw tooLargeError(maxBytes);
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString('utf-8');
    } catch (error) {
      throw this.toTransportError(error);
    }
  }

  /** Parse a JSON response and turn any ZeroBounce error shape into a ZeroBounceError. */
  private async readJson(res: Response, options: RequestOptions = {}): Promise<unknown> {
    const text = await this.readText(res, MAX_JSON_BYTES);
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }

    if (!res.ok) this.throwForResponse(res.status, text, body, options);

    if (body === undefined) {
      if (/^\s*</.test(text)) throw errorFromHttpStatus(403, '');
      throw new ZeroBounceError('api_error', `ZeroBounce returned an unreadable response: ${this.scrub(snippet(text)) || '(empty)'}`);
    }

    const message = extractApiError(body, this.messageOptions(body, options));
    if (message) throw errorFromApiMessage(this.scrub(message), res.status);
    return body;
  }

  private throwForResponse(status: number, text: string, body?: unknown, options: RequestOptions = {}): never {
    if (status !== 429 && body !== undefined) {
      const message = extractApiError(body, this.messageOptions(body, options));
      if (message) throw errorFromApiMessage(this.scrub(message), status);
    }
    throw errorFromHttpStatus(status, this.scrub(snippet(text)));
  }

  /**
   * guessformat errors look like {"Message": "..."}; successful responses always
   * carry result fields, so only treat Message as an error when those are absent.
   */
  private messageOptions(body: unknown, options: RequestOptions): { messageIsError: boolean } {
    if (!options.messageIsError || !body || typeof body !== 'object') return { messageIsError: false };
    const obj = body as Record<string, unknown>;
    const hasResult = ['email', 'format', 'domain', 'company_name', 'failure_reason'].some(k => k in obj);
    return { messageIsError: !hasResult };
  }

  private scrub(text: string): string {
    return scrubSecret(text, this.apiKey);
  }
}
