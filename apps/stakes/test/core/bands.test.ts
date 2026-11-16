import { describe, expect, it } from 'vitest';
import { DEFAULT_BANDS, bandFor, suggestPriority } from '../../src/core/bands.js';

describe('bands', () => {
  it.each([
    [0, 'lowest'],
    [14, 'lowest'],
    [15, 'low'],
    [34, 'low'],
    [35, 'medium'],
    [54, 'medium'],
    [55, 'high'],
    [74, 'high'],
    [75, 'highest'],
    [100, 'highest'],
  ])('puts %i in %s', (s, band) => {
    expect(bandFor(s, DEFAULT_BANDS)).toBe(band);
  });

  it('suggests the mapped Jira priority', () => {
    expect(suggestPriority(89, DEFAULT_BANDS)).toBe('Highest');
    expect(suggestPriority(25, DEFAULT_BANDS)).toBe('Low');
  });

  it('suggests nothing when the band has no mapped priority', () => {
    const bands = { ...DEFAULT_BANDS, priorities: { ...DEFAULT_BANDS.priorities, highest: null } };
    expect(suggestPriority(89, bands)).toBeNull();
    expect(suggestPriority(60, bands)).toBe('High');
  });

  it('follows custom thresholds', () => {
    const bands = { ...DEFAULT_BANDS, thresholds: { highest: 90, high: 70, medium: 40, low: 10 } };
    expect(bandFor(89, bands)).toBe('high');
    expect(bandFor(10, bands)).toBe('low');
  });
});
