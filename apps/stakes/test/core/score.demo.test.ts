import { describe, expect, it } from 'vitest';
import { ISSUE_KEY_PATTERN } from '@stakes/contracts';
import { DEFAULT_BANDS, suggestPriority } from '../../src/core/bands.js';
import { detect, detectThresholds } from '../../src/core/detect.js';
import { demoEvidence } from '../../src/core/demo.js';
import { normalise } from '../../src/core/normalise.js';
import { DEFAULT_WEIGHTS, score } from '../../src/core/score.js';
import { rawSignals } from '../../src/core/signals.js';
import { DEMO_DATA } from '../../src/services/demoData.js';
import { seededScore } from '../../src/services/seed.js';

const ANCHOR = new Date(`${DEMO_DATA.project.anchorDate}T10:00:00.000Z`);

function hero(key: string, opts: { seededAt?: Date; withGoals?: boolean } = {}) {
  const seededAt = opts.seededAt ?? ANCHOR;
  const evidence = demoEvidence(DEMO_DATA, key, {
    seededAt,
    now: seededAt,
    withGoals: opts.withGoals ?? true,
  });
  const { percentiles } = DEMO_DATA.project;
  const result = score(
    normalise(rawSignals(evidence, seededAt), percentiles, percentiles.scoredCount),
    DEFAULT_WEIGHTS,
  );
  const issue = DEMO_DATA.issues.find((i) => i.key === key)!;
  const history = issue.history;
  const badges = detect({
    score: result.score,
    currentPriority: issue.priority,
    evidenceCount: evidence.length,
    // The history array ends the day before seeding, so seven days ago is the 7th from the end.
    score7DaysAgo: history ? history[history.length - 7]! : null,
    thresholds: detectThresholds(DEFAULT_BANDS, 20),
  });
  return {
    score: result.score,
    suggested: suggestPriority(result.score, DEFAULT_BANDS),
    badges,
    evidence,
  };
}

describe('demo calibration from the real seed files', () => {
  it('PAY-142 scores 89, suggested Highest, silent fire', () => {
    expect(hero('PAY-142')).toMatchObject({
      score: 89,
      suggested: 'Highest',
      badges: ['silent-fire'],
    });
  });

  it('PAY-118 scores 72, suggested High, with a stakes jump from its history', () => {
    expect(hero('PAY-118')).toMatchObject({
      score: 72,
      suggested: 'High',
      badges: ['stakes-jump'],
    });
  });

  it('PAY-131 scores 25, suggested Low', () => {
    expect(hero('PAY-131')).toMatchObject({ score: 25, suggested: 'Low', badges: [] });
  });

  it('PAY-150 scores 0, suggested Lowest, phantom priority', () => {
    expect(hero('PAY-150')).toMatchObject({
      score: 0,
      suggested: 'Lowest',
      badges: ['phantom'],
      evidence: [],
    });
  });

  it('PAY-142 scores 83 until the goal is linked by hand', () => {
    expect(hero('PAY-142', { withGoals: false })).toMatchObject({
      score: 83,
      badges: ['silent-fire'],
    });
  });

  it('scores the same whatever day the demo is loaded', () => {
    for (const day of ['2026-12-31T08:00:00Z', '2027-03-14T23:30:00Z']) {
      const seededAt = new Date(day);
      for (const key of ['PAY-142', 'PAY-118', 'PAY-131', 'PAY-150']) {
        expect(hero(key, { seededAt }).score, `${key} seeded ${day}`).toBe(hero(key).score);
      }
    }
  });

  it('has exactly four deliberate priority mismatches with badges', () => {
    const flagged = DEMO_DATA.issues
      .map(
        (i) =>
          [
            i.key,
            hero(i.key, { withGoals: false }).badges.filter((b) => b !== 'stakes-jump'),
          ] as const,
      )
      .filter(([, b]) => b.length > 0)
      .map(([k, b]) => `${k}:${b.join(',')}`);
    expect(flagged).toEqual([
      'PAY-127:silent-fire',
      'PAY-139:phantom',
      'PAY-142:silent-fire',
      'PAY-150:phantom',
    ]);
  });

  it('keeps flat history lines at each issue’s seeded score, so no other issue jumps', () => {
    expect(seededScore(DEMO_DATA, 'PAY-131', ANCHOR)).toBe(25);
    const jumps = DEMO_DATA.issues
      .filter((i) => hero(i.key).badges.includes('stakes-jump'))
      .map((i) => i.key);
    expect(jumps).toEqual(['PAY-118']);
  });
});

describe('seed file shape', () => {
  const { customers, deals, issues, requests, messages, project } = DEMO_DATA;
  const issueKeys = new Set(issues.map((i) => i.key));
  const customerIds = new Set(customers.map((c) => c.id));

  it('matches the documented dataset', () => {
    expect(issues).toHaveLength(25);
    expect(requests).toHaveLength(15);
    expect(customers).toHaveLength(8);
    expect(deals).toHaveLength(12);
    expect(messages.filter((m) => m.issueKey === 'PAY-142')).toHaveLength(6);
    expect(requests.filter((r) => r.escalated)).toHaveLength(3);
    expect(issues.filter((i) => i.fixVersion).map((i) => i.key)).toContain('PAY-142');
    expect(issues.filter((i) => i.fixVersion)).toHaveLength(5);
    expect(project.sprints.map((s) => s.id)).toEqual(['active', 'future']);
  });

  it('keeps deals within US$20K–220K, closing Nov 2026 to Feb 2027', () => {
    for (const d of deals) {
      expect(d.amountUsd).toBeGreaterThanOrEqual(20_000);
      expect(d.amountUsd).toBeLessThanOrEqual(220_000);
      expect(d.closeDate! >= '2026-11-01' && d.closeDate! <= '2027-02-28', d.id).toBe(true);
    }
  });

  it('only references issues and customers that exist', () => {
    for (const i of issues) expect(ISSUE_KEY_PATTERN.test(i.key)).toBe(true);
    for (const d of deals) {
      expect(customerIds.has(d.customerId), d.id).toBe(true);
      for (const k of d.issueKeys) expect(issueKeys.has(k), `${d.id} → ${k}`).toBe(true);
    }
    for (const r of requests) expect(issueKeys.has(r.linkedIssue), r.key).toBe(true);
    for (const m of messages) expect(issueKeys.has(m.issueKey), m.id).toBe(true);
    for (const i of issues) if (i.history) expect(i.history).toHaveLength(30);
  });
});
