import { describe, expect, it } from "vitest";
import { convertFromEur, formatPrice } from "../src/currency.js";
import { SettingsStore } from "../src/settings-store.js";

const DEFAULTS = { messageReplies: true, decklistReplies: false, cooldownSeconds: 0 };

describe("currency conversion", () => {
  it("returns the amount unchanged in euros", () => {
    expect(convertFromEur(1.49, "EUR")).toBe(1.49);
    expect(formatPrice(1.49, "EUR")).toBe("€1.49");
  });

  it("uses the symbol rather than the code for every supported currency", () => {
    expect(formatPrice(1.49, "USD")).toMatch(/^\$\d+\.\d{2}$/);
    expect(formatPrice(1.49, "GBP")).toMatch(/^£\d+\.\d{2}$/);
    expect(formatPrice(1.49, "JPY")).toMatch(/^¥\d+$/);
    expect(formatPrice(1.49, "CNY")).toMatch(/^¥\d+\.\d{2} RMB$/);
  });

  it("distinguishes renminbi from yen, which share a sign", () => {
    expect(formatPrice(1.49, "CNY")).toContain("RMB");
    expect(formatPrice(1.49, "JPY")).not.toContain("RMB");
  });

  it("drops the minor unit for yen", () => {
    expect(formatPrice(1.49, "JPY")).not.toContain(".");
  });
});

describe("currency resolution", () => {
  it("prefers the user's choice over the server default", () => {
    const store = new SettingsStore(undefined, DEFAULTS);
    store.update("g1", { currency: "GBP" });
    store.setCurrency("u1", "USD");
    expect(store.resolveCurrency("u1", "g1")).toBe("USD");
  });

  it("falls back to the server default for a user with no choice", () => {
    const store = new SettingsStore(undefined, DEFAULTS);
    store.update("g1", { currency: "GBP" });
    expect(store.resolveCurrency("u2", "g1")).toBe("GBP");
  });

  it("resolves a currency when the row exists only for a reply preference", () => {
    const store = new SettingsStore(undefined, DEFAULTS);
    store.update("g1", { currency: "GBP" });
    store.setMessageReplies("u6", false);
    expect(store.currencyFor("u6")).toBeUndefined();
    expect(store.resolveCurrency("u6", "g1")).toBe("GBP");
    expect(store.resolveCurrency("u6", null)).toBe("EUR");
  });

  it("keeps a reply preference when the currency is cleared", () => {
    const store = new SettingsStore(undefined, DEFAULTS);
    store.setCurrency("u7", "USD");
    store.setMessageReplies("u7", false);
    store.clearCurrency("u7");
    expect(store.messageRepliesFor("u7")).toBe(false);
    expect(store.currencyFor("u7")).toBeUndefined();
  });

  it("returns a user to the server default after clearing their choice", () => {
    const store = new SettingsStore(undefined, DEFAULTS);
    store.update("g1", { currency: "GBP" });
    store.setCurrency("u5", "CNY");
    expect(store.resolveCurrency("u5", "g1")).toBe("CNY");
    store.clearCurrency("u5");
    expect(store.resolveCurrency("u5", "g1")).toBe("GBP");
  });

  it("falls back to euros when neither has chosen", () => {
    const store = new SettingsStore(undefined, DEFAULTS);
    expect(store.resolveCurrency("u3", "g1")).toBe("EUR");
    expect(store.resolveCurrency("u3", null)).toBe("EUR");
  });

  it("rejects an unsupported currency", () => {
    const store = new SettingsStore(undefined, DEFAULTS);
    expect(() => store.setCurrency("u4", "CHF" as never)).toThrow("EUR, USD, GBP, JPY or CNY");
    expect(() => store.update("g1", { currency: "CHF" as never })).toThrow("EUR, USD, GBP, JPY or CNY");
  });
});
