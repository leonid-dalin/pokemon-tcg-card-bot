import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import type { Card, CardSummary } from "../src/api/types.js";
import { lookupCard, isCardId, POCKET_ATTRIBUTION } from "../src/lookup.js";

const dragapult = JSON.parse(
  readFileSync(new URL("./fixtures/dragapult-ex-sv08.5-073.json", import.meta.url), "utf8"),
) as Card;

function clientReturning(summaries: CardSummary[]): TcgdexClient {
  let calls = 0;
  const client = {
    searchByName: async () => {
      calls += 1;
      return summaries;
    },
    getCard: async (id: string) => {
      const summary = summaries.find((entry) => entry.id === id);
      return { ...dragapult, id, ...(summary ? { name: summary.name } : {}) };
    },
  } as unknown as TcgdexClient;
  (client as unknown as { calls: () => number }).calls = () => calls;
  return client;
}

const PTCG_PREF = { allowed: "ptcg", default: "ptcg" } as const;
const POCKET_PREF = { allowed: "pocket", default: "pocket" } as const;
const BOTH_PREF_POCKET = { allowed: "both", default: "pocket" } as const;

describe("per-server card game preference in lookupCard", () => {
  it("keeps a physical set hint in charge on a Pocket-only server", async () => {
    const client = clientReturning([{ id: "sv08.5-073", name: "Charizard ex", localId: "073" }]);
    const lookup = await lookupCard(client, "Charizard ex", "sv08.5", { gamePreference: POCKET_PREF });
    expect(lookup?.card.id).toBe("sv08.5-073");
    expect((client as unknown as { calls: () => number }).calls()).toBe(1);
  });

  it("lets an explicit Pocket hint win on a physical-only server", async () => {
    const client = clientReturning([]);
    const lookup = await lookupCard(client, "Mewtwo", "pocket", { gamePreference: PTCG_PREF });
    expect(lookup?.attribution).toBe(POCKET_ATTRIBUTION);
  });

  it("routes a Pocket set hint to a Pocket card on a physical-only server", async () => {
    const client = clientReturning([{ id: "A1-036", name: "Charizard ex", localId: "036" }]);
    const lookup = await lookupCard(client, "Charizard ex", "A1", { gamePreference: POCKET_PREF });
    expect(lookup?.card.id.toLowerCase()).toBe("a1-036");
  });

  it("resolves an explicit Pocket set hint through the package on a physical-only server", async () => {
    const client = clientReturning([{ id: "A1-036", name: "Charizard ex", localId: "036" }]);
    const lookup = await lookupCard(client, "Charizard ex", "A1", { gamePreference: PTCG_PREF });
    expect(lookup?.attribution).toBe(POCKET_ATTRIBUTION);
    expect((client as unknown as { calls: () => number }).calls()).toBe(0);
  });

  it("falls back to the package for a Pocket set hint on a physical-only server with empty upstream", async () => {
    const client = clientReturning([]);
    const lookup = await lookupCard(client, "Charizard ex", "Genetic Apex", { gamePreference: PTCG_PREF });
    expect(lookup?.attribution).toBe(POCKET_ATTRIBUTION);
  });

  it("returns no result when a concrete Pocket set hint has no matching package card", async () => {
    const client = clientReturning([]);
    const lookup = await lookupCard(client, "Sigilyph", "A1", { gamePreference: PTCG_PREF });
    expect(lookup).toBeUndefined();

    const matching = await lookupCard(client, "Sigilyph", "A1a", { gamePreference: PTCG_PREF });
    expect(matching?.card.id.toLowerCase()).toBe("a1a-033");
  });

  it("keeps a Pocket set hint eligible for package fallback when upstream is empty", async () => {
    const client = clientReturning([]);
    const lookup = await lookupCard(client, "Charizard ex", "Genetic Apex");
    expect(lookup?.attribution).toBe(POCKET_ATTRIBUTION);
    expect((client as unknown as { calls: () => number }).calls()).toBe(1);
  });

  it("prefers the physical record of a shared name even when its image is missing", async () => {
    const client = clientReturning([
      { id: "A1-036", name: "Charizard ex", localId: "036", image: "https://example.com/pocket.webp" },
      { id: "sv03-125", name: "Charizard ex", localId: "125" },
    ]);
    const lookup = await lookupCard(client, "Charizard ex", undefined, {
      gamePreference: { allowed: "both", default: "ptcg" },
    });
    expect(lookup?.card.id).toBe("sv03-125");
  });

  it("prefers the Pocket record of a shared name when Pocket is the default", async () => {
    const client = clientReturning([
      { id: "A1-036", name: "Charizard ex", localId: "036", image: "https://example.com/pocket.webp" },
      { id: "sv03-125", name: "Charizard ex", localId: "125" },
    ]);
    const lookup = await lookupCard(client, "Charizard ex", undefined, { gamePreference: BOTH_PREF_POCKET });
    expect(lookup?.attribution).toBe(POCKET_ATTRIBUTION);
  });

  it("drops TCGdex Pocket records from a physical-only lookup", async () => {
    const client = clientReturning([{ id: "A2b-010", name: "Pikachu", localId: "010" }]);
    const lookup = await lookupCard(client, "Pikachu", undefined, { gamePreference: PTCG_PREF });
    expect(lookup).toBeUndefined();
  });

  it("keeps answering when both games are allowed and TCGdex holds the record", async () => {
    const client = clientReturning([{ id: "A2b-010", name: "Pikachu", localId: "010" }]);
    const lookup = await lookupCard(client, "Pikachu", undefined, { gamePreference: { allowed: "both", default: "ptcg" } });
    expect(lookup?.card.id).toBe("A2b-010");
  });

  it("prefers the exact Pocket card on a shared name when Pocket is the default", async () => {
    const client = clientReturning([{ id: "sv08.5-073", name: "Mewtwo", localId: "073" }]);
    const lookup = await lookupCard(client, "Mewtwo", undefined, { gamePreference: BOTH_PREF_POCKET });
    expect(lookup?.attribution).toBe(POCKET_ATTRIBUTION);
  });

  it("does not let a partial Pocket match beat an exact physical-only name", async () => {
    const client = clientReturning([{ id: "sv08.5-073", name: "Pikachu VMAX", localId: "073" }]);
    const lookup = await lookupCard(client, "Pikachu VMAX", undefined, { gamePreference: BOTH_PREF_POCKET });
    expect(lookup?.card.name).toBe("Pikachu VMAX");
    expect(lookup?.attribution).toBeUndefined();
  });
});

vi.restoreAllMocks();

  it("resolves Rika through the C1 hint on a physical-only server", async () => {
    const client = clientReturning([]);
    const lookup = await lookupCard(client, "Rika", "C1", { gamePreference: PTCG_PREF });
    expect(lookup?.card.name).toBe("Rika");
    expect(lookup?.card.id.toLowerCase()).toMatch(/^c1-/);
  });

  it("resolves Rika through the Dual Fusion name on a physical-only server", async () => {
    const client = clientReturning([]);
    const lookup = await lookupCard(client, "Rika", "Dual Fusion", { gamePreference: PTCG_PREF });
    expect(lookup?.card.name).toBe("Rika");
  });

  it("still resolves an older Pocket set by name", async () => {
    const client = clientReturning([]);
    const lookup = await lookupCard(client, "Rika", "Genetic Apex", { gamePreference: PTCG_PREF });
    expect(lookup).toBeUndefined();
  });

  it("resolves Pikachu through the printed P-C hint", async () => {
    const client = clientReturning([]);
    const lookup = await lookupCard(client, "Pikachu", "P-C", { gamePreference: PTCG_PREF });
    expect(lookup?.card.id.toLowerCase()).toBe("pc-001");
  });

  it("resolves the same card through pc and Promo-C", async () => {
    const client = clientReturning([]);
    const byId = await lookupCard(client, "Pikachu", "pc", { gamePreference: PTCG_PREF });
    const byName = await lookupCard(client, "Pikachu", "Promo-C", { gamePreference: PTCG_PREF });
    expect(byId?.card.id.toLowerCase()).toBe("pc-001");
    expect(byName?.card.id.toLowerCase()).toBe("pc-001");
  });

  it("accepts the printed set code and number as a card id", async () => {
    const client = clientReturning([]);
    const asHint = await lookupCard(client, "Rika", "C1 168", {});
    const asQuery = await lookupCard(client, "c1 168", "pocket", {});
    expect(asHint?.card.id.toLowerCase()).toBe("c1-168");
    expect(asQuery?.card.id.toLowerCase()).toBe("c1-168");
  });

  it("still rejects a printed form that names no card", async () => {
    const client = clientReturning([]);
    expect(await lookupCard(client, "Rika", "C1 999", {})).toBeUndefined();
  });

  it("accepts a physical set code as a card id", async () => {
    const client = clientReturning([{ id: "bw3-101a", name: "N", localId: "101a" }]);
    expect(isCardId("NVI 101")).toBe(true);
    expect(isCardId("NVI 101a")).toBe(true);
    const byCode = await lookupCard(client, "N", "NVI 101a", {});
    expect(byCode?.card.id.toLowerCase()).toBe("bw3-101a");
  });

  it("still rejects an unknown set code", () => {
    expect(isCardId("ZZZ 1")).toBe(false);
  });

  it("addresses a padded package record through its printed number", async () => {
    const client = clientReturning([{ id: "a1-036", name: "Charizard ex", localId: "036" }]);
    const byPrinted = await lookupCard(client, "Charizard", "A1 36", {});
    expect(byPrinted?.card.id.toLowerCase()).toBe("a1-036");
    expect(await lookupCard(client, "Charizard", "A1 036", {})).toBeDefined();
  });

  it("addresses a printed promo code and number", async () => {
    const client = clientReturning([]);
    const byPrinted = await lookupCard(client, "Pikachu", "P-C 1", {});
    expect(byPrinted?.card.id.toLowerCase()).toBe("pc-001");
    expect(isCardId("P-C 1")).toBe(true);
  });
