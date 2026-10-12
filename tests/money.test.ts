import { describe, expect, it } from "vitest";
import { formatMoney, parseAmount, toMinor } from "../src/lib/money.js";

describe("parseAmount (amounts from the Apple Pay Shortcut)", () => {
  it.each([
    ["$12.50", "AUD", 1250, "AUD"],
    ["A$12.50", "AUD", 1250, "AUD"],
    ["AU$ 7.05", "AUD", 705, "AUD"],
    ["$1,234.50", "AUD", 123450, "AUD"],
    ["AUD 1,500", "AUD", 150000, "AUD"],
    ["$4.500", "CLP", 4500, "CLP"],
    ["CLP 4.500", "AUD", 4500, "CLP"],
    ["$1.234.567", "CLP", 1234567, "CLP"],
    ["12,50 €", "AUD", 1250, "EUR"],
    ["1.234,56 €", "AUD", 123456, "EUR"],
    ["US$3.99", "AUD", 399, "USD"],
    ["8", "AUD", 800, "AUD"],
    ["$5.", "AUD", 500, "AUD"],
    ["$12.50 ", "AUD", 1250, "AUD"],
  ])("%s (default %s) → %i %s", (input, def, minor, currency) => {
    expect(parseAmount(input, def)).toEqual({ amountMinor: minor, currency });
  });

  it("returns null when there is no amount", () => {
    expect(parseAmount("gratis", "AUD")).toBeNull();
    expect(parseAmount("$0.00", "AUD")).toBeNull();
  });
});

describe("toMinor / formatMoney", () => {
  it("respects each currency's decimals", () => {
    expect(toMinor(12.5, "AUD")).toBe(1250);
    expect(toMinor(5000, "CLP")).toBe(5000);
    expect(toMinor(0.1 + 0.2, "AUD")).toBe(30);
  });

  it("shows the currency when it is not the base one", () => {
    expect(formatMoney(1250, "AUD", "AUD")).toBe("$12.50");
    expect(formatMoney(4500, "CLP", "AUD")).toBe("$4.500 CLP");
  });
});
