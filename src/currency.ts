import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { type Currency, formatMoney } from "./settings-store.js";

const requireModule = createRequire(import.meta.url);

let SNAPSHOT_DATE: string | undefined;

const RATES: Record<Currency, number> = loadRates();

/** The bundled snapshot's date, so callers can show how old the rates are. */
export function ratesDate(): string | undefined {
  return SNAPSHOT_DATE;
}

/** Reads the bundled EUR rates once; the package ships a dated snapshot and makes no network call. */
function loadRates(): Record<Currency, number> {
  const root = dirname(requireModule.resolve("@fawazahmed0/currency-api/package.json"));
  const payload = JSON.parse(readFileSync(join(root, "v1", "currencies", "eur.min.json"), "utf8")) as {
    eur?: Record<string, number>;
    date?: string;
  };
  const table = payload.eur ?? (payload as unknown as Record<string, number>);
  const read = (code: string): number => {
    const value = table[code.toLowerCase()];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(`bundled exchange rate for ${code} is missing`);
    }
    return value;
  };
  SNAPSHOT_DATE = payload.date;
  return { EUR: 1, USD: read("usd"), GBP: read("gbp"), JPY: read("jpy"), CNY: read("cny") };
}

/** Converts a EUR amount into the requested currency using the bundled snapshot. */
export function convertFromEur(amountEur: number, currency: Currency): number {
  return amountEur * RATES[currency];
}

/** Formats a EUR amount in the requested currency, with the symbol and no currency code. */
export function formatPrice(amountEur: number, currency: Currency): string {
  return formatMoney(convertFromEur(amountEur, currency), currency);
}
