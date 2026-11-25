import { describe, expect, it } from "vitest";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { isCardId, lookupCard } from "../src/lookup.js";

const api = new TcgdexClient({ retries: 0, timeoutMs: 12000 });

describe("A3 a valid set id is not a card id", () => {
  it("classifies 30th-c as a set, not a card id", () => {
    expect(isCardId("30th-c")).toBe(false);
  });

  it("resolves Greninja BREAK in 30th-c as a set hint", async () => {
    expect((await lookupCard(api, "Greninja BREAK", "30th-c"))?.card.id).toBe("30th-c-009");
  });

  it("keeps printed code and number as a real card id", async () => {
    expect(isCardId("30C 9")).toBe(true);
    expect((await lookupCard(api, "Greninja BREAK", "30C 9"))?.card.id).toBe("30th-009");
  });
});
