import { describe, expect, it } from "vitest";
import { isWindowOpen, localDate, localHour, periodRange, startOfLocalDay } from "../src/lib/time.js";

const TZ = "Australia/Sydney";

describe("Sydney time zone", () => {
  it("converts to local date and hour", () => {
    // 2026-10-04 12:00 UTC = 2026-10-04 23:00 in Sydney (AEDT, +11)
    const d = new Date("2026-10-04T12:00:00Z");
    expect(localDate(d, TZ)).toBe("2026-10-04");
    expect(localHour(d, TZ)).toBe(23);
  });

  it("computes the start of day with and without daylight saving", () => {
    expect(startOfLocalDay("2026-10-05", TZ).toISOString()).toBe("2026-10-04T13:00:00.000Z"); // AEDT +11
    expect(startOfLocalDay("2026-07-01", TZ).toISOString()).toBe("2026-06-30T14:00:00.000Z"); // AEST +10
  });

  it("weeks start on Monday", () => {
    const now = new Date("2026-10-08T01:00:00Z"); // Thursday 8th in Sydney
    expect(periodRange("week", now, TZ).from.toISOString()).toBe("2026-10-04T13:00:00.000Z"); // Monday 5th
    expect(periodRange("month", now, TZ).from.toISOString()).toBe("2026-09-30T14:00:00.000Z"); // 1 Oct (still AEST)
  });
});

describe("isWindowOpen (WhatsApp 24h window)", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  it("is open if they wrote less than ~24h ago", () => {
    expect(isWindowOpen(new Date("2026-10-04T00:00:00Z"), now)).toBe(true);
  });
  it("is closed if they never wrote or it was over 24h ago", () => {
    expect(isWindowOpen(null, now)).toBe(false);
    expect(isWindowOpen(new Date("2026-10-03T12:00:00Z"), now)).toBe(false);
  });
});
