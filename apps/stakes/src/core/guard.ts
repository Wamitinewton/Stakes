import type { EvidenceItem } from '@stakes/contracts';
import { distinctCustomers, factsOf, openDeals } from './signals';

// The model may only repeat facts it was given. Every number in its output (money,
// percentages, counts, dates) and every ticket or evidence id it names is checked
// against what the evidence contains; anything else rejects the whole text, and the
// caller shows a template instead.

export interface GuardOptions {
  // The issue being written about; its key and number may always appear.
  issueKey?: string;
  // Trusted text the prompt also carried (issue summary, version name, customer name).
  // Numbers inside it may be repeated. Untrusted ticket excerpts never go here.
  context?: string[];
  // Names that must not appear at all, such as other customers in a customer draft.
  forbiddenNames?: string[];
}

export type GuardResult = { ok: true } | { ok: false; offending: string[] };

type Token =
  | { kind: 'cite'; raw: string; id: string }
  | { kind: 'id'; raw: string; id: string }
  | { kind: 'date'; raw: string; date: string }
  | { kind: 'pct'; raw: string; value: number }
  | { kind: 'money'; raw: string; value: number; abbr: Abbr | null; symbol: boolean }
  | { kind: 'plain'; raw: string; value: number };

// How an abbreviated amount was written, so "US$0.5M" can match 480000 the way a person
// rounding to one decimal would write it.
interface Abbr {
  scale: number;
  decimals: number;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const MONTH =
  '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const ORD = '(?:st|nd|rd|th)?';
const NUM = '(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d+))?';
const SCALE_WORD = '(k|K|m|M|mn|bn|B|thousand|million|billion)';

const SCALES: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mn: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

const pad = (n: number) => String(n).padStart(2, '0');
const monthOf = (name: string) => MONTHS[name.slice(0, 3).toLowerCase()]!;
const toNumber = (int: string, frac?: string) =>
  Number(`${int.replace(/,/g, '')}${frac ? `.${frac}` : ''}`);

// Full dates become YYYY-MM-DD, a day without a year becomes --MM-DD and a month
// without a day becomes YYYY-MM, so each can be compared at the precision it was written.
const PATTERNS: Array<{ re: RegExp; read: (m: RegExpExecArray) => Token | null }> = [
  {
    re: /\[([^\]]*\bev-[^\]]*)\]/g,
    read: () => null, // expanded into one token per cited id below
  },
  {
    re: /\bev-[a-z_]+-[A-Za-z0-9._:-]*[A-Za-z0-9]/g,
    read: (m) => ({ kind: 'cite', raw: m[0], id: m[0] }),
  },
  {
    re: /\b[A-Z][A-Z0-9_]+-\d+\b/g,
    read: (m) => ({ kind: 'id', raw: m[0], id: m[0] }),
  },
  {
    re: /\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?\b/g,
    read: (m) => ({ kind: 'date', raw: m[0], date: `${m[1]}-${m[2]}-${m[3]}` }),
  },
  {
    re: new RegExp(`\\b(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH}\\.?(?:,?\\s+(\\d{4}))?\\b`, 'g'),
    read: (m) => {
      const day = Number(m[1]);
      const month = monthOf(m[2]!);
      return {
        kind: 'date',
        raw: m[0],
        date: m[3] ? `${m[3]}-${pad(month)}-${pad(day)}` : `--${pad(month)}-${pad(day)}`,
      };
    },
  },
  {
    re: new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?\\b`, 'g'),
    read: (m) => {
      const month = monthOf(m[1]!);
      const day = Number(m[2]);
      return {
        kind: 'date',
        raw: m[0],
        date: m[3] ? `${m[3]}-${pad(month)}-${pad(day)}` : `--${pad(month)}-${pad(day)}`,
      };
    },
  },
  {
    re: new RegExp(`\\b${MONTH}\\.?,?\\s+(\\d{4})\\b`, 'g'),
    read: (m) => ({ kind: 'date', raw: m[0], date: `${m[2]}-${pad(monthOf(m[1]!))}` }),
  },
  {
    re: new RegExp(`(?<![\\w.])${NUM}\\s*(?:%|per\\s?cent\\b)`, 'g'),
    read: (m) => ({ kind: 'pct', raw: m[0], value: toNumber(m[1]!, m[2]) }),
  },
  {
    re: new RegExp(`(?:US\\$|USD\\s?|\\$)\\s?${NUM}(?:\\s?${SCALE_WORD}\\b)?`, 'g'),
    read: (m) => money(m, true),
  },
  {
    re: new RegExp(`(?<![\\w.])${NUM}\\s?${SCALE_WORD}\\b`, 'g'),
    read: (m) => money(m, false),
  },
  {
    re: new RegExp(`(?<![\\w.])${NUM}\\s?(?:USD|dollars)\\b`, 'g'),
    read: (m) => ({
      kind: 'money',
      raw: m[0],
      value: toNumber(m[1]!, m[2]),
      abbr: null,
      symbol: true,
    }),
  },
  {
    // Deliberately loose: any digits left over are checked, including "5x" or "Q4",
    // so a number glued to a letter cannot slip past.
    re: new RegExp(`(?<!\\d)${NUM}${ORD}`, 'g'),
    read: (m) => ({ kind: 'plain', raw: m[0], value: toNumber(m[1]!, m[2]) }),
  },
];

function money(m: RegExpExecArray, symbol: boolean): Token {
  const base = toNumber(m[1]!, m[2]);
  const word = m[3];
  const scale = word ? SCALES[word.toLowerCase()]! : 1;
  return {
    kind: 'money',
    raw: m[0].trim(),
    value: base * scale,
    abbr: word ? { scale, decimals: m[2]?.length ?? 0 } : null,
    symbol,
  };
}

// Patterns run in order and each match is blanked out, so "PAY-142" is read as an id
// before "142" could be read as a count, and "15 Dec 2026" as a date before "15".
export function tokenize(text: string): Token[] {
  let rest = text;
  const out: Token[] = [];
  for (const [i, { re, read }] of PATTERNS.entries()) {
    rest = rest.replace(re, (...args) => {
      const match = args.slice(0, -2) as unknown as RegExpExecArray;
      if (i === 0) {
        for (const id of match[1]!.split(/[\s,;]+/)) {
          if (id.startsWith('ev-')) out.push({ kind: 'cite', raw: `[${id}]`, id });
        }
      } else {
        const token = read(match);
        if (token) out.push(token);
      }
      return ' '.repeat(match[0].length);
    });
  }
  return out;
}

export function citedIds(text: string): string[] {
  return [
    ...new Set(
      tokenize(text)
        .filter((t) => t.kind === 'cite')
        .map((t) => (t as { id: string }).id),
    ),
  ];
}

interface Allowed {
  ids: Set<string>;
  evidenceIds: Set<string>;
  dates: Set<string>;
  pct: number[];
  money: number[];
  plain: number[];
}

// Text a person outside the team can write cannot vouch for a number: a support
// request's title is the customer's own summary, and a conversation's detail is the
// message itself. Their computed fields (priority, age, channel) are still trusted.
export function trustedText(e: EvidenceItem): string[] {
  if (e.type === 'jsm_request' || e.type === 'escalation') return [e.detail];
  if (e.type === 'conversation') return [e.title];
  return [e.title, e.detail];
}

const dayOf = (value: string | null | undefined) =>
  value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function addText(allowed: Allowed, text: string) {
  for (const t of tokenize(text)) {
    if (t.kind === 'cite' || t.kind === 'id') allowed.ids.add(t.id);
    else if (t.kind === 'date') allowed.dates.add(t.date);
    else if (t.kind === 'pct') allowed.pct.push(t.value);
    else if (t.kind === 'money') {
      allowed.money.push(t.value);
      allowed.plain.push(t.value);
    } else allowed.plain.push(t.value);
  }
}

function buildAllowed(evidence: EvidenceItem[], opts: GuardOptions): Allowed {
  const allowed: Allowed = {
    ids: new Set(),
    evidenceIds: new Set(evidence.map((e) => e.id)),
    dates: new Set(),
    pct: [],
    money: [],
    plain: [],
  };

  for (const e of evidence) {
    allowed.ids.add(e.id);
    for (const text of trustedText(e)) addText(allowed, text);
    for (const key of e.url.match(/[A-Z][A-Z0-9_]+-\d+/g) ?? []) allowed.ids.add(key);
    if (e.value !== null) {
      (e.unit === 'USD' ? allowed.money : allowed.plain).push(e.value);
      allowed.plain.push(e.value, Math.round(e.value * 10) / 10);
    }
    const f = e.facts;
    if (f.kind === 'deal') {
      allowed.ids.add(f.dealId);
      allowed.money.push(f.amountUsd);
      allowed.pct.push(Math.round(f.probability * 1000) / 10);
      for (const d of [f.closeDate]) if (dayOf(d)) allowed.dates.add(dayOf(d)!);
    } else if (f.kind === 'customer') {
      allowed.ids.add(f.customerId);
      allowed.money.push(f.arrUsd);
      if (dayOf(f.renewalDate)) allowed.dates.add(dayOf(f.renewalDate)!);
    } else if (f.kind === 'request') {
      allowed.ids.add(f.requestKey);
      for (const d of [f.createdAt, f.slaBreachAt]) if (dayOf(d)) allowed.dates.add(dayOf(d)!);
    } else if (f.kind === 'conversation') {
      if (dayOf(f.at)) allowed.dates.add(dayOf(f.at)!);
    }
  }

  // Totals a reader would reasonably state: per type, overall, per customer, and the
  // open deals alone ("US$480K across 3 deals"). Arbitrary subsets are not allowed.
  const byType = new Map<string, EvidenceItem[]>();
  for (const e of evidence) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
  for (const items of byType.values()) {
    allowed.plain.push(items.length);
    const usd = items.filter((e) => e.unit === 'USD' && e.value !== null);
    if (usd.length > 0) allowed.money.push(sum(usd.map((e) => e.value!)));
  }
  const usdAll = evidence.filter((e) => e.unit === 'USD' && e.value !== null);
  allowed.money.push(sum(usdAll.map((e) => e.value!)));

  const deals = openDeals(evidence);
  allowed.money.push(sum(deals.map((d) => d.amountUsd)));
  allowed.plain.push(deals.length);
  const perCustomer = new Map<string, number>();
  for (const d of deals) {
    if (d.customerId)
      perCustomer.set(d.customerId, (perCustomer.get(d.customerId) ?? 0) + d.amountUsd);
  }
  allowed.money.push(...perCustomer.values());

  const customers = distinctCustomers(evidence);
  allowed.plain.push(customers.length);
  allowed.money.push(sum(customers.map((c) => c.arrUsd)));

  const requests = factsOf(evidence, 'request');
  allowed.plain.push(requests.length, requests.filter((r) => r.escalated).length);
  allowed.plain.push(evidence.length);

  if (opts.issueKey) {
    allowed.ids.add(opts.issueKey);
    const n = Number(opts.issueKey.slice(opts.issueKey.lastIndexOf('-') + 1));
    if (Number.isFinite(n)) allowed.plain.push(n);
  }
  for (const text of opts.context ?? []) addText(allowed, text);

  // A date vouches for its year written alone ("in 2027"), but not for its day: bare
  // days of the month are common small numbers and would let invented counts through.
  for (const date of allowed.dates) {
    const year = date.slice(0, 4);
    if (/^\d{4}$/.test(year)) allowed.plain.push(Number(year));
  }
  return allowed;
}

const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

function moneyAllowed(t: Extract<Token, { kind: 'money' }>, pool: number[]): boolean {
  return pool.some((a) => {
    if (a <= 0) return same(a, t.value);
    if (Math.abs(t.value - a) <= a * 0.01) return true;
    if (!t.abbr) return false;
    const factor = 10 ** t.abbr.decimals;
    return same(Math.round((a / t.abbr.scale) * factor) / factor, t.value / t.abbr.scale);
  });
}

function dateAllowed(date: string, dates: Set<string>): boolean {
  if (dates.has(date)) return true;
  if (date.startsWith('--')) return [...dates].some((d) => d.endsWith(date.slice(1)));
  if (date.length === 7) return [...dates].some((d) => d.startsWith(date));
  return false;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function checkNumbers(
  text: string,
  evidence: EvidenceItem[],
  opts: GuardOptions = {},
): GuardResult {
  const allowed = buildAllowed(evidence, opts);
  const offending: string[] = [];

  for (const t of tokenize(text)) {
    let ok: boolean;
    switch (t.kind) {
      case 'cite':
        ok = allowed.evidenceIds.has(t.id);
        break;
      case 'id':
        ok = allowed.ids.has(t.id);
        break;
      case 'date':
        ok = dateAllowed(t.date, allowed.dates);
        break;
      case 'pct':
        ok = allowed.pct.some((p) => same(p, t.value));
        break;
      case 'money':
        ok = moneyAllowed(t, t.symbol ? allowed.money : [...allowed.money, ...allowed.plain]);
        break;
      case 'plain':
        ok = allowed.plain.some((p) => same(p, t.value));
        break;
    }
    if (!ok) offending.push(t.raw);
  }

  for (const name of opts.forbiddenNames ?? []) {
    const trimmed = name.trim();
    if (trimmed.length < 2) continue;
    if (new RegExp(`(?<![\\w])${escapeRe(trimmed)}(?![\\w])`, 'i').test(text)) {
      offending.push(trimmed);
    }
  }

  return offending.length === 0 ? { ok: true } : { ok: false, offending: [...new Set(offending)] };
}
