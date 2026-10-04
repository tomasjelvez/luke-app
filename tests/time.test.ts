import { describe, expect, it } from "vitest";
import { isWindowOpen, localDate, localHour, periodRange, startOfLocalDay } from "../src/lib/time.js";

const TZ = "Australia/Sydney";

describe("zona horaria de Sydney", () => {
  it("convierte a fecha y hora local", () => {
    // 2026-10-04 12:00 UTC = 2026-10-04 23:00 en Sydney (AEDT, +11)
    const d = new Date("2026-10-04T12:00:00Z");
    expect(localDate(d, TZ)).toBe("2026-10-04");
    expect(localHour(d, TZ)).toBe(23);
  });

  it("calcula el inicio del día con y sin horario de verano", () => {
    expect(startOfLocalDay("2026-10-05", TZ).toISOString()).toBe("2026-10-04T13:00:00.000Z"); // AEDT +11
    expect(startOfLocalDay("2026-07-01", TZ).toISOString()).toBe("2026-06-30T14:00:00.000Z"); // AEST +10
  });

  it("la semana parte el lunes", () => {
    const now = new Date("2026-10-08T01:00:00Z"); // jueves 8 en Sydney
    expect(periodRange("week", now, TZ).from.toISOString()).toBe("2026-10-04T13:00:00.000Z"); // lunes 5
    expect(periodRange("month", now, TZ).from.toISOString()).toBe("2026-09-30T14:00:00.000Z"); // 1 oct (aún AEST)
  });
});

describe("isWindowOpen (ventana de 24 h de WhatsApp)", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  it("abierta si escribió hace menos de ~24 h", () => {
    expect(isWindowOpen(new Date("2026-10-04T00:00:00Z"), now)).toBe(true);
  });
  it("cerrada si nunca escribió o fue hace más de 24 h", () => {
    expect(isWindowOpen(null, now)).toBe(false);
    expect(isWindowOpen(new Date("2026-10-03T12:00:00Z"), now)).toBe(false);
  });
});
