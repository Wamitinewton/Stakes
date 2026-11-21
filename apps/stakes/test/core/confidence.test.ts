import { describe, expect, it } from 'vitest';
import { confidence } from '../../src/core/confidence';
import { customer, deal, message, request } from './evidence';

const now = new Date('2026-11-20T08:00:00.000Z');
const sevenDaysAgo = '2026-11-13T08:00:00.000Z';
const justOver = '2026-11-13T07:59:59.000Z';

describe('confidence', () => {
  it('is low with no evidence or one type, however many items', () => {
    expect(confidence([], now)).toBe('low');
    expect(
      confidence([request('H-1', 'Low', sevenDaysAgo), request('H-2', 'Low', sevenDaysAgo)], now),
    ).toBe('low');
  });

  it('is medium with two types', () => {
    expect(confidence([deal('D1', 1, 1), customer('C1', 'smb')], now)).toBe('medium');
  });

  it('is high with three fresh types, counting a 7-day-old item as fresh', () => {
    const items = [
      deal('D1', 1, 1, { fetchedAt: sevenDaysAgo }),
      customer('C1', 'smb'),
      message('M1', sevenDaysAgo),
    ];
    expect(confidence(items, now)).toBe('high');
  });

  it('drops to medium when any of three types is older than 7 days', () => {
    const items = [
      deal('D1', 1, 1, { fetchedAt: justOver }),
      customer('C1', 'smb'),
      message('M1', sevenDaysAgo),
    ];
    expect(confidence(items, now)).toBe('medium');
  });
});
