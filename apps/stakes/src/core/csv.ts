import {
  ISSUE_KEY_PATTERN,
  type CsvFile,
  type CsvRejection,
  type IssueKey,
  type Tier,
} from '@stakes/contracts';

export const MAX_CSV_BYTES = 1024 * 1024;
export const MAX_CSV_ROWS = 5000;

export const CUSTOMER_COLUMNS = [
  'customer_id',
  'customer_name',
  'tier',
  'arr_usd',
  'renewal_date',
  'owner_email',
] as const;

export const DEAL_COLUMNS = [
  'deal_id',
  'deal_name',
  'customer_id',
  'amount_usd',
  'stage',
  'probability',
  'close_date',
  'deal_owner_email',
  'blocked_by_issues',
] as const;

export interface CsvCustomer {
  id: string;
  name: string;
  tier: Tier;
  arrUsd: number;
  renewalDate: string | null;
  ownerEmail: string | null;
}

export interface CsvDeal {
  id: string;
  name: string;
  customerId: string;
  amountUsd: number;
  stage: string;
  probability: number;
  closeDate: string | null;
  ownerEmail: string | null;
  issueKeys: IssueKey[];
}

export type CsvImport =
  | { ok: true; customers: CsvCustomer[]; deals: CsvDeal[] }
  | { ok: false; rejected: CsvRejection[] };

export interface CsvTable {
  columns: string[];
  // Each row keeps its spreadsheet row number (the header is row 1), which is what an
  // admin sees when they open the file to fix it.
  rows: Array<{ row: number; cells: Record<string, string>; values: string[] }>;
}

// RFC 4180: fields may be quoted, quotes inside are doubled, and quoted fields may hold
// commas and line breaks. Blank lines are skipped and a leading byte-order mark dropped.
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field.trim());
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c !== '')) rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') quoted = false;
      else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      field = '';
      quoted = true;
    } else if (ch === ',') endField();
    else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (input[i + 1] === '\n') i++;
      endRow();
    } else field += ch;
    i++;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

function byteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export function toTable(
  file: CsvFile,
  text: string,
): { ok: true; table: CsvTable } | { ok: false; rejected: CsvRejection[] } {
  if (byteLength(text) > MAX_CSV_BYTES) {
    return { ok: false, rejected: [{ file, row: 0, reason: 'File is larger than 1 MB' }] };
  }
  const [header, ...body] = parseCsv(text);
  if (!header) return { ok: false, rejected: [{ file, row: 0, reason: 'File is empty' }] };
  if (body.length > MAX_CSV_ROWS) {
    return { ok: false, rejected: [{ file, row: 0, reason: 'File has more than 5,000 rows' }] };
  }
  const columns = header.map((h) => h.toLowerCase());
  return {
    ok: true,
    table: {
      columns,
      rows: body.map((values, idx) => ({
        row: idx + 2,
        values,
        cells: Object.fromEntries(columns.map((c, ci) => [c, values[ci] ?? ''])),
      })),
    },
  };
}

// A cell starting with one of these runs as a formula when the export is opened in a
// spreadsheet, so Stakes refuses to store it rather than hand it back to someone later.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d+(\.\d+)?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function parseTier(value: string): Tier | null {
  const t = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (t === 'enterprise') return 'enterprise';
  if (t === 'mid-market' || t === 'midmarket') return 'mid-market';
  if (t === 'smb') return 'smb';
  return null;
}

// Probabilities arrive as 0.6 or as 60. Anything above 1 is read as a percentage, so 1
// itself means certain.
export function parseProbability(value: string): number | null {
  if (!DECIMAL.test(value)) return null;
  const n = Number(value);
  if (n <= 1) return n;
  if (n <= 100) return n / 100;
  return null;
}

class RowCheck {
  readonly problems: string[] = [];
  constructor(private readonly cells: Record<string, string>) {}

  text(column: string, required: boolean): string {
    const v = this.cells[column] ?? '';
    if (v === '') {
      if (required) this.problems.push(`${column} is required`);
      return '';
    }
    if (FORMULA_PREFIX.test(v)) this.problems.push(`${column} starts with a formula character`);
    return v;
  }

  amount(column: string): number {
    const v = this.cells[column] ?? '';
    if (v.startsWith('-') && DECIMAL.test(v.slice(1))) {
      this.problems.push(`${column} must not be negative`);
      return 0;
    }
    if (!DECIMAL.test(v)) {
      this.problems.push(`${column} must be a number without currency symbols or commas`);
      return 0;
    }
    return Number(v);
  }

  date(column: string): string | null {
    const v = this.cells[column] ?? '';
    if (v === '') return null;
    if (!isCalendarDate(v)) {
      this.problems.push(`${column} must be a date like 2026-12-15`);
      return null;
    }
    return v;
  }

  email(column: string): string | null {
    const v = this.text(column, false);
    if (v === '') return null;
    if (!EMAIL.test(v)) {
      this.problems.push(`${column} is not an email address`);
      return null;
    }
    return v.toLowerCase();
  }
}

function missingColumns(table: CsvTable, required: readonly string[]): string[] {
  return required.filter((c) => !table.columns.includes(c));
}

function duplicateRejections(file: CsvFile, table: CsvTable, idColumn: string): CsvRejection[] {
  const firstRow = new Map<string, number>();
  const out: CsvRejection[] = [];
  for (const r of table.rows) {
    const id = r.cells[idColumn] ?? '';
    if (id === '') continue;
    const first = firstRow.get(id);
    if (first !== undefined) {
      out.push({ file, row: r.row, reason: `${idColumn} ${id} repeats row ${first}` });
    } else firstRow.set(id, r.row);
  }
  return out;
}

export function validateCustomers(
  table: CsvTable,
): { ok: true; customers: CsvCustomer[] } | { ok: false; rejected: CsvRejection[] } {
  const missing = missingColumns(table, CUSTOMER_COLUMNS);
  if (missing.length > 0) {
    return {
      ok: false,
      rejected: [{ file: 'customers', row: 1, reason: `Missing columns: ${missing.join(', ')}` }],
    };
  }
  const rejected: CsvRejection[] = duplicateRejections('customers', table, 'customer_id');
  const customers: CsvCustomer[] = [];
  for (const r of table.rows) {
    const check = new RowCheck(r.cells);
    const id = check.text('customer_id', true);
    const name = check.text('customer_name', true);
    const tierText = check.text('tier', true);
    const tier = parseTier(tierText);
    if (tierText !== '' && !tier) check.problems.push('tier must be Enterprise, Mid-market or SMB');
    const arrUsd = check.amount('arr_usd');
    const renewalDate = check.date('renewal_date');
    const ownerEmail = check.email('owner_email');
    if (check.problems.length > 0) {
      rejected.push({ file: 'customers', row: r.row, reason: check.problems.join('; ') });
      continue;
    }
    customers.push({ id, name, tier: tier!, arrUsd, renewalDate, ownerEmail });
  }
  return rejected.length > 0 ? { ok: false, rejected } : { ok: true, customers };
}

export function validateDeals(
  table: CsvTable,
): { ok: true; deals: CsvDeal[] } | { ok: false; rejected: CsvRejection[] } {
  const missing = missingColumns(table, DEAL_COLUMNS);
  if (missing.length > 0) {
    return {
      ok: false,
      rejected: [{ file: 'deals', row: 1, reason: `Missing columns: ${missing.join(', ')}` }],
    };
  }
  const rejected: CsvRejection[] = duplicateRejections('deals', table, 'deal_id');
  const deals: CsvDeal[] = [];
  for (const r of table.rows) {
    const check = new RowCheck(r.cells);
    const id = check.text('deal_id', true);
    const name = check.text('deal_name', true);
    const customerId = check.text('customer_id', true);
    const amountUsd = check.amount('amount_usd');
    const stage = check.text('stage', true);
    const probabilityText = r.cells.probability ?? '';
    const probability = parseProbability(probabilityText);
    if (probability === null)
      check.problems.push('probability must be between 0 and 1, or 0 and 100');
    const closeDate = check.date('close_date');
    const ownerEmail = check.email('deal_owner_email');
    const keys = (r.cells.blocked_by_issues ?? '')
      .split(';')
      .map((k) => k.trim().toUpperCase())
      .filter((k) => k !== '');
    const badKeys = keys.filter((k) => !ISSUE_KEY_PATTERN.test(k));
    if (badKeys.length > 0) check.problems.push(`not issue keys: ${badKeys.join(', ')}`);
    if (check.problems.length > 0) {
      rejected.push({ file: 'deals', row: r.row, reason: check.problems.join('; ') });
      continue;
    }
    deals.push({
      id,
      name,
      customerId,
      amountUsd,
      stage,
      probability: probability!,
      closeDate,
      ownerEmail,
      issueKeys: [...new Set(keys)],
    });
  }
  return rejected.length > 0 ? { ok: false, rejected } : { ok: true, deals };
}

// All or nothing: a half-imported file leaves deals pointing at customers that never
// arrived, which is harder to notice and fix than a list of every problem up front.
export function parseImport(input: { customersCsv?: string; dealsCsv?: string }): CsvImport {
  const rejected: CsvRejection[] = [];
  let customers: CsvCustomer[] = [];
  let deals: CsvDeal[] = [];

  if (input.customersCsv !== undefined && input.customersCsv.trim() !== '') {
    const t = toTable('customers', input.customersCsv);
    if (!t.ok) rejected.push(...t.rejected);
    else {
      const v = validateCustomers(t.table);
      if (v.ok) customers = v.customers;
      else rejected.push(...v.rejected);
    }
  }
  if (input.dealsCsv !== undefined && input.dealsCsv.trim() !== '') {
    const t = toTable('deals', input.dealsCsv);
    if (!t.ok) rejected.push(...t.rejected);
    else {
      const v = validateDeals(t.table);
      if (v.ok) deals = v.deals;
      else rejected.push(...v.rejected);
    }
  }
  if (rejected.length === 0 && customers.length === 0 && deals.length === 0) {
    rejected.push({ file: 'customers', row: 0, reason: 'Paste or upload at least one file' });
  }
  rejected.sort((a, b) => a.file.localeCompare(b.file) || a.row - b.row);
  return rejected.length > 0 ? { ok: false, rejected } : { ok: true, customers, deals };
}

export function isClosedStage(stage: string): boolean {
  return /^closed[\s_-]*(won|lost)$/i.test(stage.trim());
}
