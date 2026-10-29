import { describe, expect, it, vi } from "vitest";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { lookupCard } from "../src/lookup.js";
import { printingsOf } from "../src/printings.js";
import { searchPocketByName, getPocketCard } from "../src/api/pocket.js";

vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => [] }) as unknown as Response);

const client = new TcgdexClient({ retries: 0 });

describe("a concrete Pocket hint stays within its set", () => {
  it("rejects a name the hinted set does not carry instead of widening", async () => {
    const hinted = await lookupCard(client, "Sigilyph", "A1", { gamePreference: { allowed: "both", default: "ptcg" } });
    expect(hinted === undefined || hinted.card.id.startsWith("a1-")).toBe(true);
  });

  it("resolves the same name in the set that carries it", async () => {
    const hinted = await lookupCard(client, "Sigilyph", "A1a");
    expect(hinted?.card.id.startsWith("a1a-")).toBe(true);
  });

  it("keeps the unhinted package fallback working", async () => {
    const unhinted = await lookupCard(client, "Sigilyph");
    expect(unhinted === undefined || typeof unhinted.card.id).toBe("string");
  });
});

describe("pocket names tolerate accents and apostrophes", () => {
  it.each([
    ["Poké Ball", "Poke Ball"],
    ["Professor's Research", "Professor\u2019s Research"],
  ])("resolves %s the same as %s", (accented, plain) => {
    expect(searchPocketByName(accented).length).toBe(searchPocketByName(plain).length);
    expect(searchPocketByName(accented).length).toBeGreaterThan(0);
  });

  it("finds accented names from plain keyboard spellings in lookups", async () => {
    const poke = await lookupCard(client, "Poke Ball", "pocket");
    expect(poke === undefined || typeof poke.card.id).toBe("string");
  });

  it("keeps printing enumeration on the same normalised contract", async () => {
    const accented = (await printingsOf(client, "Poke Ball", "pocket")).length;
    expect(accented).toBeGreaterThan(0);
  });
});
