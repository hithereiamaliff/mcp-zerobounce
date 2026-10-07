/**
 * ZeroBounce error normalisation.
 *
 * ZeroBounce reports errors in at least seven different shapes depending on the
 * endpoint (see docs + SDK sources). This module turns all of them into a single
 * ZeroBounceError with a friendly, actionable message.
 *
 *   getcredits      {"Credits": -1}  (or "-1" as a string)
 *   validate        {"error": "Invalid API Key or your account ran out of credits"}
 *   validatebatch   {"errors": [{"error": "...", "email_address": "all"}]}
 *   getapiusage     {"error": "Invalid API Key"}
 *   guessformat     {"Message": "Invalid API key or your account ran out of credits"}
 *   filters         {"Error": "..."}
 *   bulk endpoints  {"success": false | "False", "message": "..." | ["..."], "error_message": "..."}
 *   firewall        HTTP 403 with an HTML (Cloudflare) page
 */

export type ZeroBounceErrorKind =
  | 'auth'          // invalid key or no credits
  | 'rate_limited'  // HTTP 429 / temporary block
  | 'firewall'      // HTTP 403 "API Shield" / Cloudflare page
  | 'bad_request'   // missing/invalid parameter
  | 'not_found'
  | 'server'        // 5xx, 520, 524
  | 'timeout'
  | 'network'
  | 'api_error';    // any other error message from the API

export class ZeroBounceError extends Error {
  constructor(
    public readonly kind: ZeroBounceErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ZeroBounceError';
  }
}

const AUTH_PATTERN = /invalid api ?key|api_key is invalid|ran out of credits|missing param(eter)?: api_key/i;

const AUTH_HINT =
  'ZeroBounce rejected the API key, or the account has no credits left. ' +
  'Check the key under API → API Keys in your ZeroBounce dashboard, and your credit balance.';

/** Join a string or string[] message into one string. */
function asMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const parts = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    if (parts.length) return parts.join('; ');
  }
  return undefined;
}

function isFalseLike(value: unknown): boolean {
  return value === false || (typeof value === 'string' && value.toLowerCase() === 'false');
}

/**
 * Look inside a parsed JSON body for an error message.
 * Returns undefined if the body looks like a normal (successful) response.
 *
 * `messageIsError` should be true for endpoints where a bare {"Message": "..."}
 * means failure (guessformat). For filters, "Message" is the success text.
 */
export function extractApiError(body: unknown, options: { messageIsError?: boolean } = {}): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const obj = body as Record<string, unknown>;

  // getcredits: {"Credits": -1}
  if ('Credits' in obj && Number(obj.Credits) === -1) {
    return 'Invalid API Key';
  }

  const direct = asMessage(obj.error) ?? asMessage(obj.Error) ?? asMessage(obj.error_message);
  if (direct) return direct;

  if ('success' in obj && isFalseLike(obj.success)) {
    return asMessage(obj.message) ?? asMessage(obj.Message) ?? 'ZeroBounce reported the request as unsuccessful.';
  }

  if (options.messageIsError) {
    const message = asMessage(obj.Message) ?? asMessage(obj.message);
    if (message) return message;
  }

  return undefined;
}

/** Build a ZeroBounceError from an API error message (HTTP 200 or 4xx with JSON). */
export function errorFromApiMessage(message: string, status?: number): ZeroBounceError {
  if (AUTH_PATTERN.test(message)) {
    return new ZeroBounceError('auth', `${AUTH_HINT} (ZeroBounce said: "${message}")`, status);
  }
  return new ZeroBounceError(status && status >= 400 && status < 500 ? 'bad_request' : 'api_error', message, status);
}

/** Build a ZeroBounceError from an HTTP status when the body had no usable message. */
export function errorFromHttpStatus(status: number, bodySnippet = ''): ZeroBounceError {
  const looksLikeHtml = /^\s*</.test(bodySnippet);

  if (status === 429) {
    return new ZeroBounceError(
      'rate_limited',
      'ZeroBounce rate limit reached. The API temporarily blocks a key that goes over its limit ' +
        '(from 1 minute for validate up to 1 day for getcredits). Wait before trying again.',
      status,
    );
  }
  if (status === 403) {
    return new ZeroBounceError(
      'firewall',
      'ZeroBounce refused the request (HTTP 403, API firewall). Common causes: the API key has an ' +
        'IP allowlist that does not include this server, the key is invalid, or too many bad requests ' +
        'were sent recently. Check API → API Keys in your ZeroBounce dashboard.' +
        (looksLikeHtml ? '' : bodySnippet ? ` Response: ${bodySnippet}` : ''),
      status,
    );
  }
  if (status === 401) return new ZeroBounceError('auth', AUTH_HINT, status);
  if (status === 404) return new ZeroBounceError('not_found', 'ZeroBounce endpoint or file not found (HTTP 404).', status);
  if (status === 400 || status === 405 || status === 422) {
    return new ZeroBounceError(
      'bad_request',
      `ZeroBounce rejected the request as invalid (HTTP ${status}).` + (bodySnippet && !looksLikeHtml ? ` ${bodySnippet}` : ''),
      status,
    );
  }
  if (status >= 500) {
    return new ZeroBounceError(
      'server',
      `ZeroBounce is having trouble right now (HTTP ${status}). Try again in a minute.`,
      status,
    );
  }
  return new ZeroBounceError('api_error', `Unexpected response from ZeroBounce (HTTP ${status}).`, status);
}

/** Remove the API key from any text before it is shown or logged. */
export function scrubSecret(text: string, secret: string): string {
  if (!secret || secret.length < 4) return text;
  return text.split(secret).join('***');
}
