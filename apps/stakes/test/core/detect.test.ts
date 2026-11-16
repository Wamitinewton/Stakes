import { describe, expect, it } from 'vitest';
import { DEFAULT_BANDS } from '../../src/core/bands.js';
import { detect, detectThresholds } from '../../src/core/detect.js';

const thresholds = detectThresholds(DEFAULT_BANDS, 20);
const input = (o: Partial<Parameters<typeof detect>[0]>) => ({
  score: 0,
  currentPriority: 'Medium',
  evidenceCount: 0,
  score7DaysAgo: null,
  thresholds,
  ...o,
});

describe('detect', () => {
  it('derives thresholds from the bands and settings', () => {
    expect(thresholds).toEqual({
      silentFireMin: 55,
      phantomBelow: 15,
      jumpMin: 20,
      lowPriorities: ['low', 'lowest'],
      highPriorities: ['high', 'highest'],
    });
  });

  it('flags a silent fire from 55 at Low or Lowest, not at 54', () => {
    expect(detect(input({ score: 55, currentPriority: 'Low', evidenceCount: 3 }))).toEqual([
      'silent-fire',
    ]);
    expect(detect(input({ score: 89, currentPriority: 'lowest', evidenceCount: 3 }))).toEqual([
      'silent-fire',
    ]);
    expect(detect(input({ score: 54, currentPriority: 'Low', evidenceCount: 3 }))).toEqual([]);
    expect(detect(input({ score: 89, currentPriority: 'Medium', evidenceCount: 3 }))).toEqual([]);
  });

  it('flags a phantom only with high priority, score under 15 and no evidence', () => {
    expect(detect(input({ score: 0, currentPriority: 'Highest' }))).toEqual(['phantom']);
    expect(detect(input({ score: 14, currentPriority: 'High' }))).toEqual(['phantom']);
    expect(detect(input({ score: 15, currentPriority: 'High' }))).toEqual([]);
    expect(detect(input({ score: 0, currentPriority: 'Highest', evidenceCount: 1 }))).toEqual([]);
    expect(detect(input({ score: 0, currentPriority: 'Medium' }))).toEqual([]);
  });

  it('flags a stakes jump at +20, not +19, and never without history', () => {
    expect(detect(input({ score: 72, score7DaysAgo: 52 }))).toEqual(['stakes-jump']);
    expect(detect(input({ score: 72, score7DaysAgo: 53 }))).toEqual([]);
    expect(detect(input({ score: 72, score7DaysAgo: null }))).toEqual([]);
  });

  it('uses the thresholds it is given rather than fixed numbers', () => {
    const custom = detectThresholds(
      {
        thresholds: { highest: 90, high: 70, medium: 40, low: 10 },
        priorities: { highest: 'P1', high: 'P2', medium: 'P3', low: 'P4', lowest: null },
      },
      30,
    );
    expect(
      detect(input({ score: 69, currentPriority: 'P4', evidenceCount: 2, thresholds: custom })),
    ).toEqual([]);
    expect(
      detect(input({ score: 70, currentPriority: 'P4', evidenceCount: 2, thresholds: custom })),
    ).toEqual(['silent-fire']);
    expect(detect(input({ score: 72, score7DaysAgo: 52, thresholds: custom }))).toEqual([]);
  });
});
