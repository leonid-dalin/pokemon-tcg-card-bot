import { describe, expect, it } from "vitest";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { lookupCard } from "../src/lookup.js";
import { isPocketCardId } from "../src/prizes.js";
import { resolveSetHint } from "../src/set-index.js";

const api = new TcgdexClient({ retries: 0, timeoutMs: 12000 });

describe("A6 exact package set ids", () => {
  it("resolves pa to Promo-A before a partial physical name", () => {
    expect(resolveSetHint("pa")).toBe("pa");
  });

  it("resolves Horsea pa to the package card", async () => {
    const result = await lookupCard(api, "Horsea", "pa");
    expect(isPocket(result?.card.id)).toBe(true);
  });

  it("keeps the P-A and Promo-A aliases", async () => {
    for (const hint of ["P-A", "Promo-A"]) {
      const result = await lookupCard(api, "Horsea", hint);
      expect(isPocket(result?.card.id)).toBe(true);
    }
  });

  it("keeps bare B2 as the physical printed code", () => {
    expect(resolveSetHint("B2")).toBe("base4");
  });
});

function isPocket(id: string | undefined): boolean {
  return id !== undefined && isPocketCardId(id);
}
