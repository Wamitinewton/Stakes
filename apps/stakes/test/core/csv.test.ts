import { describe, expect, it } from 'vitest';
import {
  MAX_CSV_ROWS,
  isClosedStage,
  parseCsv,
  parseImport,
  parseProbability,
  parseTier,
} from '../../src/core/csv.js';

const CUSTOMERS_HEADER = 'customer_id,customer_name,tier,arr_usd,renewal_date,owner_email';
const DEALS_HEADER =
  'deal_id,deal_name,customer_id,amount_usd,stage,probability,close_date,deal_owner_email,blocked_by_issues';

const customers = (...rows: string[]) => [CUSTOMERS_HEADER, ...rows].join('\n');
const deals = (...rows: string[]) => [DEALS_HEADER, ...rows].join('\n');

const goodCustomer = 'CUST-007,Kilima Freight,Enterprise,420000,2027-03-31,owner@example.com';
const goodDeal =
  'DEAL-031,"Kilima Freight — Enterprise expansion",CUST-007,220000,Negotiation,0.6,2026-12-15,owner@example.com,PAY-142;PAY-118';

describe('parseCsv', () => {
  it('handles quoted commas, doubled quotes and line breaks inside quotes', () => {
    expect(parseCsv('a,b,c\n"x, y","say ""hi""","line1\nline2"\n')).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line1\nline2'],
    ]);
  });

  it('accepts CRLF and CR line endings, trims cells and skips blank lines', () => {
    expect(parseCsv('a , b\r\n\r\n 1 ,2 \r3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('strips a byte-order mark and keeps empty trailing fields', () => {
    expect(parseCsv('﻿a,b,\n1,,')).toEqual([
      ['a', 'b', ''],
      ['1', '', ''],
    ]);
  });
});

describe('parseImport', () => {
  it('parses valid customers and deals', () => {
    const result = parseImport({
      customersCsv: customers(goodCustomer),
      dealsCsv: deals(goodDeal),
    });
    expect(result).toEqual({
      ok: true,
      customers: [
        {
          row: 2,
          id: 'CUST-007',
          name: 'Kilima Freight',
          tier: 'enterprise',
          arrUsd: 420000,
          renewalDate: '2027-03-31',
          ownerEmail: 'owner@example.com',
        },
      ],
      deals: [
        {
          row: 2,
          id: 'DEAL-031',
          name: 'Kilima Freight — Enterprise expansion',
          customerId: 'CUST-007',
          amountUsd: 220000,
          stage: 'Negotiation',
          probability: 0.6,
          closeDate: '2026-12-15',
          ownerEmail: 'owner@example.com',
          issueKeys: ['PAY-142', 'PAY-118'],
        },
      ],
    });
  });

  it('accepts columns in any order and in any case', () => {
    const csv = 'TIER,customer_id,customer_name,arr_usd,renewal_date,owner_email\nsmb,C1,Acme,10,,';
    const result = parseImport({ customersCsv: csv });
    expect(result.ok && result.customers[0]).toMatchObject({
      tier: 'smb',
      renewalDate: null,
      ownerEmail: null,
    });
  });

  it('converts a probability given as a percentage', () => {
    const result = parseImport({ dealsCsv: deals(goodDeal.replace(',0.6,', ',60,')) });
    expect(result.ok && result.deals[0]!.probability).toBe(0.6);
  });

  it('lists a missing column once, against the header row', () => {
    const result = parseImport({ customersCsv: 'customer_id,customer_name\nC1,Acme' });
    expect(result).toEqual({
      ok: false,
      rejected: [
        {
          file: 'customers',
          row: 1,
          reason: 'Missing columns: tier, arr_usd, renewal_date, owner_email',
        },
      ],
    });
  });

  it('rejects every bad row with its spreadsheet row number, and imports nothing', () => {
    const result = parseImport({
      customersCsv: customers(goodCustomer, 'C2,Acme,Whale,-5,2027-02-30,not-an-email'),
      dealsCsv: deals(
        goodDeal,
        'D2,Deal,C2,$1000,Proposal,1.5x,2026-12-01,,pay-1;PAY-2',
        'D3,Deal,C2,1000,,140,,,',
      ),
    });
    expect(result).toEqual({
      ok: false,
      rejected: [
        {
          file: 'customers',
          row: 3,
          reason:
            'tier must be Enterprise, Mid-market or SMB; arr_usd must not be negative; renewal_date must be a date like 2026-12-15; owner_email is not an email address',
        },
        {
          file: 'deals',
          row: 3,
          reason:
            'amount_usd must be a number without currency symbols or commas; probability must be between 0 and 1, or 0 and 100',
        },
        {
          file: 'deals',
          row: 4,
          reason: 'stage is required; probability must be between 0 and 1, or 0 and 100',
        },
      ],
    });
  });

  it('upper-cases issue keys but rejects anything that is not one', () => {
    const ok = parseImport({
      dealsCsv: deals(goodDeal.replace('PAY-142;PAY-118', 'pay-142; PAY-142')),
    });
    expect(ok.ok && ok.deals[0]!.issueKeys).toEqual(['PAY-142']);
    const bad = parseImport({
      dealsCsv: deals(goodDeal.replace('PAY-142;PAY-118', 'PAY-142;DROP TABLE')),
    });
    expect(bad).toMatchObject({
      ok: false,
      rejected: [{ row: 2, reason: 'not issue keys: DROP TABLE' }],
    });
  });

  it.each(['=HYPERLINK("x")', '+SUM(A1)', '-2+3', '@cmd'])(
    'rejects the formula cell %s',
    (cell) => {
      const result = parseImport({
        customersCsv: customers(`C1,"${cell.replace(/"/g, '""')}",SMB,1,,`),
      });
      expect(result).toMatchObject({
        ok: false,
        rejected: [
          { file: 'customers', row: 2, reason: 'customer_name starts with a formula character' },
        ],
      });
    },
  );

  it('rejects duplicate ids, pointing at the first row', () => {
    const result = parseImport({ customersCsv: customers(goodCustomer, goodCustomer) });
    expect(result).toMatchObject({
      ok: false,
      rejected: [{ file: 'customers', row: 3, reason: 'customer_id CUST-007 repeats row 2' }],
    });
  });

  it('rejects input over 1 MB or over 5,000 rows', () => {
    const big = customers(`C1,${'x'.repeat(1024 * 1024)},SMB,1,,`);
    expect(parseImport({ customersCsv: big })).toMatchObject({
      ok: false,
      rejected: [{ row: 0, reason: 'File is larger than 1 MB' }],
    });
    const many = customers(
      ...Array.from({ length: MAX_CSV_ROWS + 1 }, (_, i) => `C${i},N,SMB,1,,`),
    );
    expect(parseImport({ customersCsv: many })).toMatchObject({
      ok: false,
      rejected: [{ row: 0, reason: 'File has more than 5,000 rows' }],
    });
  });

  it('accepts exactly 5,000 rows', () => {
    const many = customers(...Array.from({ length: MAX_CSV_ROWS }, (_, i) => `C${i},N,SMB,1,,`));
    expect(parseImport({ customersCsv: many }).ok).toBe(true);
  });

  it('asks for at least one file', () => {
    expect(parseImport({ customersCsv: '  ', dealsCsv: undefined })).toMatchObject({
      ok: false,
      rejected: [{ reason: 'Paste or upload at least one file' }],
    });
    expect(parseImport({ customersCsv: CUSTOMERS_HEADER }).ok).toBe(false);
  });
});

describe('field parsers', () => {
  it.each([
    ['Enterprise', 'enterprise'],
    ['mid market', 'mid-market'],
    ['Mid-Market', 'mid-market'],
    ['MidMarket', 'mid-market'],
    ['SMB', 'smb'],
    ['Startup', null],
  ])('reads tier %s', (input, tier) => {
    expect(parseTier(input)).toBe(tier);
  });

  it.each([
    ['0', 0],
    ['0.6', 0.6],
    ['1', 1],
    ['60', 0.6],
    ['100', 1],
    ['101', null],
    ['-0.2', null],
    ['', null],
  ])('reads probability %s', (input, p) => {
    expect(parseProbability(input)).toBe(p);
  });

  it.each([
    ['Closed Won', true],
    ['closed-lost', true],
    ['Closed_won', true],
    ['Negotiation', false],
    ['Closed', false],
  ])('knows whether %s is closed', (stage, closed) => {
    expect(isClosedStage(stage)).toBe(closed);
  });
});
