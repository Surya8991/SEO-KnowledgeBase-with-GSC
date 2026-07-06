/**
 * Minimal, dependency-free CSV serialise/parse.
 *
 * RFC-4180-ish: fields are comma-separated, records newline-separated,
 * fields containing `"` `,` `\r` or `\n` are double-quoted and inner
 * quotes doubled. The parser understands quoted fields spanning commas
 * and newlines. Good enough for the corpus import/export round-trip; not
 * a general-purpose CSV engine.
 */

/** Escape a single field for CSV output. */
export function csvField(value: unknown): string {
  const s =
    value == null
      ? ""
      : Array.isArray(value)
        ? value.join("|")
        : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialise an array of records to a CSV string given an ordered column list. */
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: readonly (keyof T & string)[],
): string {
  const head = columns.map(csvField).join(",");
  const body = rows.map((r) => columns.map((c) => csvField(r[c])).join(","));
  return [head, ...body].join("\r\n");
}

/**
 * Parse a CSV string into an array of row objects keyed by the header row.
 * Empty trailing lines are ignored. Values are always strings.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const records = parseRecords(text);
  if (records.length === 0) return [];
  const header = records[0];
  const out: Record<string, string>[] = [];
  for (let i = 1; i < records.length; i++) {
    const cells = records[i];
    // Skip blank lines (single empty cell).
    if (cells.length === 1 && cells[0] === "") continue;
    const obj: Record<string, string> = {};
    header.forEach((key, idx) => {
      obj[key] = cells[idx] ?? "";
    });
    out.push(obj);
  }
  return out;
}

/** Tokenise raw CSV text into an array of records (each an array of fields). */
function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // Handle CRLF and lone CR.
      if (text[i + 1] === "\n") i++;
      pushRecord();
      i++;
      continue;
    }
    if (ch === "\n") {
      pushRecord();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush the final field/record if the text didn't end with a newline.
  if (field !== "" || record.length > 0) pushRecord();
  return records;
}
