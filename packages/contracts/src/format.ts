// Display helpers shared by resolvers (tile and summary text) and the UI, so a number
// reads the same in the panel, the drawer and the AI summary's citations.

export function formatUsd(amount: number): string {
  const n = Math.round(amount);
  if (Math.abs(n) < 1000) return `US$${n}`;
  if (Math.abs(n) < 10_000) return `US$${trim((n / 1000).toFixed(1))}K`;
  if (Math.abs(n) < 999_500) return `US$${Math.round(n / 1000)}K`;
  return `US$${trim((n / 1_000_000).toFixed(1))}M`;
}

const trim = (s: string) => s.replace(/\.0$/, '');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Dates are shown in UTC so everyone sees the same day for a close or renewal date.
export function formatDate(value: string): string {
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
