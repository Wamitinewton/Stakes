import { describe, expect, it } from 'vitest';
import type { CustomerIssue } from '@stakes/contracts';
import { formatRenewalDate, formatTier, rankCustomerIssues } from '../src/lib/customers';

const issue = (key: string, score: number | null): CustomerIssue => ({
  key,
  summary: key,
  status: 'To Do',
  fixVersions: [],
  score,
  url: `https://example.atlassian.net/browse/${key}`,
});

describe('customer exposure presentation', () => {
  it('ranks scored issues first and leaves the source array unchanged', () => {
    const issues = [issue('PAY-10', null), issue('PAY-2', 72), issue('PAY-1', 89)];
    expect(rankCustomerIssues(issues).map((row) => row.key)).toEqual(['PAY-1', 'PAY-2', 'PAY-10']);
    expect(issues.map((row) => row.key)).toEqual(['PAY-10', 'PAY-2', 'PAY-1']);
  });

  it('formats tier labels and renewal dates for the summary', () => {
    expect(formatTier('enterprise')).toBe('Enterprise');
    expect(formatTier('mid-market')).toBe('Mid-market');
    expect(formatTier('smb')).toBe('SMB');
    expect(formatRenewalDate('2027-03-31')).toBe('31 Mar 2027');
    expect(formatRenewalDate(null)).toBe('—');
  });
});
