import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import type { Card, CardSummary } from "../src/api/types.js";
import { lookupCard, POCKET_ATTRIBUTION } from "../src/lookup.js";

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

const PTCG_ONLY = { allowed: "ptcg", default: "ptcg" } as const;
const POCKET_ONLY = { allowed: "pocket", default: "pocket" } as const;
const BOTH_PREFER_POCKET = { allowed: "both", default: "pocket" } as const;

describe("per-server card game preference in lookupCard", () => {
  it("keeps a physical set hint in charge on a Pocket-only server", async () => {
    const client = clientReturning([{ id: "sv08.5-073", name: "Charizard ex", localId: "073" }]);
    const lookup = await lookupCard(client, "Charizard ex", "sv08.5", { gamePreference: POCKET_ONLY });
    expect(lookup?.card.id).toBe("sv08.5-073");
    expect((client as unknown as { calls: () => number }).calls()).toBe(1);
  });

  it("lets an explicit Pocket hint win on a physical-only server", async () => {
    const client = clientReturning([]);
    const lookup = await lookupCard(client, "Mewtwo", "pocket", { gamePreference: PTCG_ONLY });
    expect(lookup?.attribution).toBe(POCKET_ATTRIBUTION);
  });

  it("routes a Pocket set hint to a Pocket card on a physical-only server", async () => {
    const client = clientReturning([{ id: "A1-036", name: "Charizard ex", localId: "036" }]);
    const lookup = await lookupCard(client, "Charizard ex", "A1", { gamePreference: POCKET_ONLY });
    expect(lookup?.card.id.toLowerCase()).toBe("a1-036");
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
    const lookup = await lookupCard(client, "Charizard ex", undefined, { gamePreference: BOTH_PREFER_POCKET });
    expect(lookup?.attribution).toBe(POCKET_ATTRIBUTION);
  });

  it("drops TCGdex Pocket records from a physical-only lookup", async () => {
    const client = clientReturning([{ id: "A2b-010", name: "Pikachu", localId: "010" }]);
    const lookup = await lookupCard(client, "Pikachu", undefined, { gamePreference: PTCG_ONLY });
    expect(lookup).toBeUndefined();
  });

  it("keeps answering when both games are allowed and TCGdex holds the record", async () => {
    const client = clientReturning([{ id: "A2b-010", name: "Pikachu", localId: "010" }]);
    const lookup = await lookupCard(client, "Pikachu", undefined, { gamePreference: { allowed: "both", default: "ptcg" } });
    expect(lookup?.card.id).toBe("A2b-010");
  });

  it("prefers the exact Pocket card on a shared name when Pocket is the default", async () => {
    const client = clientReturning([{ id: "sv08.5-073", name: "Mewtwo", localId: "073" }]);
    const lookup = await lookupCard(client, "Mewtwo", undefined, { gamePreference: BOTH_PREFER_POCKET });
    expect(lookup?.attribution).toBe(POCKET_ATTRIBUTION);
  });

  it("does not let a partial Pocket match beat an exact physical-only name", async () => {
    const client = clientReturning([{ id: "sv08.5-073", name: "Pikachu VMAX", localId: "073" }]);
    const lookup = await lookupCard(client, "Pikachu VMAX", undefined, { gamePreference: BOTH_PREFER_POCKET });
    expect(lookup?.card.name).toBe("Pikachu VMAX");
    expect(lookup?.attribution).toBeUndefined();
  });
});

vi.restoreAllMocks();
