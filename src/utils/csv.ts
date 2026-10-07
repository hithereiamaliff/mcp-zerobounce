/**
 * Minimal RFC 4180 CSV helpers (no dependency).
 *
 * - toCsv:    build the CSV we upload to ZeroBounce from in-memory rows.
 * - parseCsv: read the results files ZeroBounce sends back.
 */

function escapeField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return rows.map(row => row.map(escapeField).join(',')).join('\r\n') + '\r\n';
}

/**
 * Parse CSV text into rows of fields.
 * Handles quoted fields, escaped quotes (""), commas/newlines inside quotes,
 * CRLF or LF line endings, a UTF-8 BOM, and the stray space ZeroBounce's docs
 * sometimes show after a comma (`"a", "b"`).
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false; // true once a field has non-whitespace content or an opening quote

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      field = '';
    } else if (ch === ',') {
      row.push(field);
      field = '';
      fieldStarted = false;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStarted = false;
    } else if ((ch === ' ' || ch === '\t') && !fieldStarted) {
      // Skip leading whitespace before a (possibly quoted) field.
    } else {
      field += ch;
      fieldStarted = true;
    }
  }

  // Last field / row (file may not end with a newline).
  if (field !== '' || fieldStarted || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop completely empty lines.
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

/** Count rows in user-provided CSV content (used for validation messages). */
export function countDataRows(csv: string, hasHeaderRow: boolean): number {
  const rows = parseCsv(csv);
  return Math.max(0, rows.length - (hasHeaderRow ? 1 : 0));
}
