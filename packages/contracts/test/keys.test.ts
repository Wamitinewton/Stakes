import { describe, expect, it } from 'vitest';
import { IssueKey, ProjectKey, isIssueKey, projectKeyOf } from '../src/index.js';

describe('issue and project keys', () => {
  it.each(['PAY-142', 'HELP-1', 'A1_B-99'])('accepts %s', (key) => {
    expect(isIssueKey(key)).toBe(true);
    expect(IssueKey.safeParse(key).success).toBe(true);
  });

  it.each(['pay-142', 'PAY', 'PAY-', '-142', 'PAY-14a', 'PAY-142 OR 1=1', '1PAY-2', 42, null])(
    'rejects %s',
    (key) => {
      expect(isIssueKey(key)).toBe(false);
      expect(IssueKey.safeParse(key).success).toBe(false);
    },
  );

  it('derives the project key, even when the project key contains digits', () => {
    expect(projectKeyOf('PAY-142')).toBe('PAY');
    expect(projectKeyOf('P2P-7')).toBe('P2P');
  });

  it('validates project keys', () => {
    expect(ProjectKey.safeParse('PAY').success).toBe(true);
    expect(ProjectKey.safeParse('pay').success).toBe(false);
    expect(ProjectKey.safeParse('P').success).toBe(false);
  });
});
