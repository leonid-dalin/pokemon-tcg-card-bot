import { describe, expect, it } from "vitest";
import { lookupById, isCardId } from "../src/lookup.js";
import { TcgdexError, type TcgdexClient } from "../src/api/tcgdex.js";

/** Transport that only knows the ids the real services carry. */
function clientKnowing(ids: string[]): TcgdexClient & { requested: string[] } {
  const requested: string[] = [];
  const known = new Set(ids);
  const client = {
    requested,
    searchByName: async () => [],
    getCard: async (id: string) => {
      requested.push(id);
      if (known.has(id)) return { id, name: "Card" };
      throw new TcgdexError("missing", 404);
    },
  } as unknown as TcgdexClient & { requested: string[] };
  return client;
}

describe("printed forms through lookupById", () => {
  it("resolves a printed promo form to the package id", async () => {
    const client = clientKnowing(["pc-001"]);
    const result = await lookupById(client, "P-C 1");
    expect(result?.card.id).toBe("pc-001");
  });

  it("pads a modern physical number that the service stores padded", async () => {
    const client = clientKnowing(["sv08.5-073"]);
    const result = await lookupById(client, "PRE 73");
    expect(result?.card.id.toLowerCase()).toBe("sv08.5-073");
  });

  it("keeps older unpadded physical ids working without a second request", async () => {
    const client = clientKnowing(["bw3-101"]);
    const result = await lookupById(client, "NVI 101");
    expect(result?.card.id).toBe("bw3-101");
    expect(client.requested).toEqual(["bw3-101"]);
  });

  it("accepts the printed forms as ids", () => {
    expect(isCardId("P-C 1")).toBe(true);
    expect(isCardId("PRE 73")).toBe(true);
    expect(isCardId("NVI 101")).toBe(true);
  });
});
