import type { CustomerIssue, Tier } from '@stakes/contracts';

export function rankCustomerIssues(issues: CustomerIssue[]): CustomerIssue[] {
  return [...issues].sort(
    (a, b) =>
      (b.score ?? -1) - (a.score ?? -1) || a.key.localeCompare(b.key, undefined, { numeric: true }),
  );
}

export function formatTier(tier: Tier): string {
  return tier === 'smb' ? 'SMB' : tier === 'mid-market' ? 'Mid-market' : 'Enterprise';
}

export function formatRenewalDate(date: string | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}
