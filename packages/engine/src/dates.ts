/** All dates are America/Denver calendar dates as "YYYY-MM-DD" strings. */
export const TZ = "America/Denver";

/** Today's calendar date in Denver. */
export function denverToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function toUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const DAY = 86_400_000;

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY);
}

/** 0 = Monday .. 6 = Sunday. Computed from the date, never shifted by timezone. */
export function weekdayMon0(date: string): number {
  return (new Date(toUtc(date)).getUTCDay() + 6) % 7;
}

export function mondayOf(date: string): string {
  return addDays(date, -weekdayMon0(date));
}
