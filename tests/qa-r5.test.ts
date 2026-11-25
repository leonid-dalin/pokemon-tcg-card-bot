import { describe, expect, it } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import type { Card, CardSummary } from "../src/api/types.js";
import { readFileSync } from "node:fs";
import { lookupCard } from "../src/lookup.js";
import { isPocketCardId } from "../src/prizes.js";

const base = JSON.parse(readFileSync(new URL("./fixtures/selection-card-me03-030.json", import.meta.url), "utf8")) as Card;
const pocketDefault = { allowed: "both", default: "pocket" } as const;
const physicalDefault = { allowed: "both", default: "ptcg" } as const;

function client(summaries: CardSummary[]): TcgdexClient {
  return {
    searchByName: async () => summaries,
    getCard: async (id: string) => ({ ...base, id, name: summaries.find((card) => card.id.toLowerCase() === id.toLowerCase())?.name ?? "Clefairy" }),
  } as unknown as TcgdexClient;
}

describe("R5 the default game applies symmetrically", () => {
  it("returns a Pocket card for an unhinted shared name on Pocket-default", async () => {
    const summaries: CardSummary[] = [
      { id: "me02.5-160", name: "Dragapult ex", localId: "160" },
      { id: "a4b-158", name: "Dragapult ex", localId: "158" },
    ];
    const result = await lookupCard(client(summaries), "Dragapult ex", undefined, { gamePreference: pocketDefault });
    expect(result).toBeDefined();
    expect(isPocketCardId(result!.card.id)).toBe(true);
  });

  it("returns no physical card for a physical-only name on Pocket-default", async () => {
    const summaries: CardSummary[] = [{ id: "gym2-69", name: "Erika's Jigglypuff", localId: "69" }];
    const result = await lookupCard(client(summaries), "Erika's Jigglypuff", undefined, { gamePreference: pocketDefault });
    expect(result === undefined || isPocketCardId(result.card.id)).toBe(true);
  });

  it("never returns a physical card for a short name on Pocket-default", async () => {
    const summaries: CardSummary[] = [{ id: "xy10-105a", name: "N", localId: "105a" }];
    const result = await lookupCard(client(summaries), "N", undefined, { gamePreference: pocketDefault });
    expect(result === undefined || isPocketCardId(result.card.id)).toBe(true);
  });

  it("keeps the physical result for a short name on physical-default", async () => {
    const summaries: CardSummary[] = [{ id: "xy10-105a", name: "N", localId: "105a" }];
    const result = await lookupCard(client(summaries), "N", undefined, { gamePreference: physicalDefault });
    expect(result?.card.id).toBe("xy10-105a");
  });
});
