import { describe, expect, it } from 'vitest';
import { formatDate, formatUsd, plural } from '../src/index.js';

describe('formatUsd', () => {
  it.each([
    [0, 'US$0'],
    [950, 'US$950'],
    [7_500, 'US$7.5K'],
    [9_000, 'US$9K'],
    [20_000, 'US$20K'],
    [316_000, 'US$316K'],
    [480_000, 'US$480K'],
    [999_499, 'US$999K'],
    [999_500, 'US$1M'],
    [1_250_000, 'US$1.3M'],
  ])('formats %i as %s', (n, text) => {
    expect(formatUsd(n)).toBe(text);
  });
});

describe('formatDate and plural', () => {
  it('formats dates and timestamps in UTC', () => {
    expect(formatDate('2026-12-15')).toBe('15 Dec 2026');
    expect(formatDate('2027-01-01T01:00:00+03:00')).toBe('31 Dec 2026');
    expect(formatDate('not a date')).toBe('not a date');
  });

  it('pluralises', () => {
    expect(plural(1, 'deal')).toBe('1 deal');
    expect(plural(3, 'deal')).toBe('3 deals');
    expect(plural(2, 'person', 'people')).toBe('2 people');
  });
});
