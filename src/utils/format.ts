/**
 * Small markdown helpers so every tool formats output the same way.
 */

/** ZeroBounce returns booleans as true/"true"/"True"; normalise to a boolean. */
export function isTrue(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.toLowerCase() === 'true');
}

/** True for values worth showing (skips null, undefined, empty strings and "unknown"). */
export function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '' && value.toLowerCase() !== 'unknown';
  return true;
}

/** Escape text for a markdown table cell. */
export function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function table(headers: string[], rows: unknown[][]): string {
  const head = `| ${headers.map(cell).join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(r => `| ${r.map(cell).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

/** "- **Label:** value" lines, skipping empty values. */
export function bullets(entries: Array<[string, unknown]>): string {
  return entries
    .filter(([, v]) => hasValue(v))
    .map(([k, v]) => `- **${k}:** ${v}`)
    .join('\n');
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** Today's date (UTC) as yyyy-mm-dd, optionally shifted by a number of days. */
export function isoDate(offsetDays = 0, from = new Date()): string {
  const d = new Date(from.getTime() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}
