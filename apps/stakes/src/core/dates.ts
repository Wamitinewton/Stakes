const DAY_MS = 86_400_000;

// Day counts compare calendar dates in UTC rather than elapsed milliseconds, so a deal
// closing "in 25 days" says 25 all day long instead of ticking down by the hour.
function utcDay(value: Date | string): number {
  const d =
    typeof value === 'string'
      ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
      : value;
  return Math.floor(d.getTime() / DAY_MS);
}

export function isValidDate(value: string): boolean {
  return !Number.isNaN(new Date(value.length === 10 ? `${value}T00:00:00Z` : value).getTime());
}

// Positive when `date` is after `now`.
export function daysBetween(now: Date, date: Date | string): number {
  return utcDay(date) - utcDay(now);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
