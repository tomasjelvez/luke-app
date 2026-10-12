/** Decimal places each currency uses (CLP: 0, AUD: 2, ...), as Intl knows them. */
export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
}

export function toMinor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** currencyDigits(currency));
}

export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** currencyDigits(currency);
}

const LOCALE_BY_CURRENCY: Record<string, string> = {
  AUD: "en-AU",
  CLP: "es-CL",
  USD: "en-US",
  EUR: "es-ES",
  GBP: "en-GB",
  NZD: "en-NZ",
};

/**
 * "$12.50" for the base currency; "$4.500 CLP" for any other, so they aren't
 * confused within the same summary.
 */
export function formatMoney(minor: number, currency: string, baseCurrency?: string): string {
  const formatted = new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency] ?? "en", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).format(fromMinor(minor, currency));
  return baseCurrency && currency !== baseCurrency ? `${formatted} ${currency}` : formatted;
}

// Most specific prefixes first: "A$" must win over "$".
const SYMBOLS: [string, string][] = [
  ["AU$", "AUD"],
  ["A$", "AUD"],
  ["NZ$", "NZD"],
  ["US$", "USD"],
  ["CL$", "CLP"],
  ["€", "EUR"],
  ["£", "GBP"],
];

/**
 * Parses the amount the Apple Pay Shortcut sends. iOS formats it according to
 * the phone's region, so it can arrive as "$12.50", "A$12.50", "AUD 1,234.50",
 * "CLP 4.500" or "12,50 €".
 */
export function parseAmount(
  input: string,
  defaultCurrency: string,
): { amountMinor: number; currency: string } | null {
  const text = input.trim();
  let currency = defaultCurrency;

  const code = text.match(/\b([A-Z]{3})\b/);
  const symbol = SYMBOLS.find(([s]) => text.includes(s));
  if (code?.[1] && isCurrencyCode(code[1])) currency = code[1];
  else if (symbol) currency = symbol[1];

  const numeric = text.match(/\d[\d.,\s  ]*/)?.[0]?.replace(/[\s  ]/g, "");
  if (!numeric) return null;

  const amount = parseNumber(numeric.replace(/[.,]$/, ""), currencyDigits(currency));
  if (amount === null) return null;
  return { amountMinor: toMinor(amount, currency), currency };
}

function parseNumber(s: string, digits: number): number | null {
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");

  let normalized: string;
  if (lastDot !== -1 && lastComma !== -1) {
    // Both separators: the last one is the decimal separator.
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    normalized = s.split(thousands).join("").replace(decimal, ".");
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? "." : ",";
    const parts = s.split(sep);
    const tail = parts.at(-1) ?? "";
    // It's a thousands separator if it repeats ("1.234.567"), if the currency has
    // no decimals (CLP) or if exactly 3 digits follow it ("1,500").
    const isThousands = parts.length > 2 || digits === 0 || tail.length === 3;
    normalized = isThousands ? parts.join("") : parts.join(".");
  } else {
    normalized = s;
  }

  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isCurrencyCode(code: string): boolean {
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return Intl.supportedValuesOf("currency").includes(code);
  } catch {
    return false;
  }
}
