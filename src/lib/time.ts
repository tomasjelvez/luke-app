/** Local date "YYYY-MM-DD" in the given time zone. */
export function localDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function localHour(date: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(date));
}

/** The time zone's offset from UTC (in minutes) at a given instant. */
function offsetMinutes(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** UTC instant at which the local day "YYYY-MM-DD" starts (00:00). Handles daylight saving. */
export function startOfLocalDay(day: string, timeZone: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d));
  // Two passes in case a DST change falls near midnight.
  let result = new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60_000);
  result = new Date(guess.getTime() - offsetMinutes(result, timeZone) * 60_000);
  return result;
}

export type Period = "today" | "week" | "month";

/** [from, to) range of the local period containing `now`. Weeks start on Monday. */
export function periodRange(period: Period, now: Date, timeZone: string): { from: Date; to: Date } {
  const today = localDate(now, timeZone);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const base = new Date(Date.UTC(y, m - 1, d));
  let startDay: Date;
  if (period === "today") startDay = base;
  else if (period === "week") startDay = new Date(base.getTime() - ((base.getUTCDay() + 6) % 7) * 86_400_000);
  else startDay = new Date(Date.UTC(y, m - 1, 1));
  return { from: startOfLocalDay(startDay.toISOString().slice(0, 10), timeZone), to: now };
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SAFETY_MARGIN_MS = 5 * 60 * 1000;

/** Is the 24h window to freely message the user still open? */
export function isWindowOpen(lastInboundAt: Date | null, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < WINDOW_MS - SAFETY_MARGIN_MS;
}
