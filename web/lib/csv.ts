// Minimal RFC-4180-ish CSV parser (handles quoted fields with embedded commas,
// newlines, and escaped "" quotes). No dependency needed.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // flush trailing field/row (file without trailing newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const NAME_KEYS = [
  "applicant_name",
  "name",
  "applicant",
  "candidate",
  "candidate_name",
  "full_name",
];
const TEXT_KEYS = [
  "raw_text",
  "text",
  "application",
  "application_text",
  "notes",
  "details",
  "bio",
  "about",
];

export type ParsedRow = { applicant_name: string; raw_text: string };
export type CsvParseResult = {
  rows: ParsedRow[];
  errors: string[];
  total: number;
};

/**
 * Parse a CSV string into application rows. Expects a header row containing a
 * name column and a text column (flexible header names). Returns valid rows
 * plus per-row errors for anything skipped.
 */
export function parseApplicationsCsv(
  text: string,
  maxRows = 1000,
): CsvParseResult {
  const errors: string[] = [];
  const grid = parseCsv(text).filter(
    (r) => r.length > 0 && r.some((c) => c.trim() !== ""),
  );

  if (grid.length === 0) {
    return { rows: [], errors: ["CSV is empty."], total: 0 };
  }

  const header = grid[0].map((h) => h.trim().toLowerCase());
  const nameIdx = header.findIndex((h) => NAME_KEYS.includes(h));
  const textIdx = header.findIndex((h) => TEXT_KEYS.includes(h));

  if (nameIdx === -1 || textIdx === -1) {
    return {
      rows: [],
      errors: [
        `Missing required columns. Need a name column (one of: ${NAME_KEYS.join(", ")}) and a text column (one of: ${TEXT_KEYS.join(", ")}). Found header: [${header.join(", ")}].`,
      ],
      total: 0,
    };
  }

  const body = grid.slice(1);
  const rows: ParsedRow[] = [];
  for (let i = 0; i < body.length; i++) {
    if (rows.length >= maxRows) {
      errors.push(
        `Row limit reached (${maxRows}); remaining rows were skipped.`,
      );
      break;
    }
    const cols = body[i];
    const name = (cols[nameIdx] ?? "").trim();
    const raw = (cols[textIdx] ?? "").trim();
    const lineNo = i + 2; // 1-based, accounting for header
    if (!name && !raw) continue; // blank line
    if (!name) {
      errors.push(`Row ${lineNo}: missing name — skipped.`);
      continue;
    }
    if (!raw) {
      errors.push(`Row ${lineNo}: missing application text — skipped.`);
      continue;
    }
    rows.push({ applicant_name: name, raw_text: raw });
  }

  return { rows, errors, total: body.length };
}
