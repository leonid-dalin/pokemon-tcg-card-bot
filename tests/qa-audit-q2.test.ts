import { describe, expect, it } from "vitest";
import { TcgdexError } from "../src/api/tcgdex.js";
import { lookupCard } from "../src/lookup.js";
import { indexedText } from "../src/text-search.js";

const outage = {
  searchByName: async () => { throw new TcgdexError("injected outage", 503); },
  getCard: async () => { throw new TcgdexError("injected missing", 404); },
} as never;

describe("Q2 promo aliases share the wording guard", () => {
  it("indexes native and printed promo ids identically", () => {
    expect(indexedText("pa-023")).toBe(indexedText("P-A-023"));
    expect(indexedText("pa-023")).toContain("vine whip");
  });

  it("offers only same-wording swaps for the native promo id under outage", async () => {
    const result = await lookupCard(outage, "pa-023");
    expect(result?.card.id.toLowerCase()).toBe("pa-023");
    const controls = result!.matchingPrintings.map((card) => card.id.toLowerCase());
    expect(controls).not.toContain("c1-001");
    expect(controls).not.toContain("b4b-001");
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((id) => ["a3-210", "a1-001", "a1-227"].includes(id))).toBe(true);
  });
});
