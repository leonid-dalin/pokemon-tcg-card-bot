import { describe, expect, it } from "vitest";
import { lookupById, isCardId } from "../src/lookup.js";
import { printedNumber } from "../src/printed.js";
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

describe("gallery footers", () => {
  const gallery = [
    ["swsh9tg-TG23", "BRS TG23"],
    ["swsh12tg-TG01", "SIT TG01"],
    ["swsh12.5gg-GG01", "CRZ GG01"],
    ["swsh4.5sv-SV001", "SHF SV001"],
    ["cel25cc-CC001", "CEL CC001"],
  ];

  it("formats a subset printing with its parent code", () => {
    for (const [id, footer] of gallery) expect(printedNumber(id!)).toBe(footer);
  });

  it("resolves the footer back to the subset set, not the parent set", async () => {
    for (const [id, footer] of gallery) {
      const client = clientKnowing([id!]);
      const result = await lookupById(client, footer!);
      expect(result?.card.id.toLowerCase(), footer).toBe(id!.toLowerCase());
      // The parent set id must never be requested instead of the subset.
      expect(client.requested[0]).not.toBe(id!.split("-")[0]);
    }
  });

  it("keeps an older unpadded physical id working", async () => {
    const client = clientKnowing(["bw3-101"]);
    expect((await lookupById(client, "NVI 101"))?.card.id).toBe("bw3-101");
  });
});
