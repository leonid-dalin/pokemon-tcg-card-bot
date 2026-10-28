import { afterEach, describe, expect, it, vi } from "vitest";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { accentVariants, lookupCard } from "../src/lookup.js";

afterEach(() => vi.unstubAllGlobals());

interface StubRoute {
  status?: number;
  body: unknown;
}

/** The stub returns results only for the exact `name=` value it receives. */
function stubSearch(hits: Record<string, { id: string; name: string }[]>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const name = new URL(url).searchParams.get("name") ?? "";
    if (url.includes("/cards/") && !url.includes("?")) {
      const id = url.split("/cards/")[1] ?? "";
      return { ok: true, status: 200, json: async () => ({ id, name: id, localId: "1" }) } as unknown as Response;
    }
    const body = hits[name] ?? [];
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  });
  return { calls };
}

const pokeStop = [{ id: "swsh10.5-068", name: "PokéStop", localId: "068", image: "https://assets.tcgdex.net/en/swsh/swsh10.5/068" }];

describe("accentVariants", () => {
  it("offers the accented spellings of an unaccented name", () => {
    const variants = accentVariants("PokeStop");
    expect(variants).toContain("PokéStop");
  });

  it("offers the Pokémon spelling of a Trainer name", () => {
    expect(accentVariants("Pokemon Catcher")).toEqual(["Pokémon Catcher"]);
  });

  it("offers nothing for a name it cannot accent", () => {
    expect(accentVariants("Slowpoke")).toEqual([]);
    expect(accentVariants("Iono")).toEqual([]);
  });

  it("offers the accent for a mid-word vowel", () => {
    expect(accentVariants("Flabebe")).toContain("Flabébé");
    expect(accentVariants("Cafe Master")).toContain("Café Master");
  });

  it("leaves a name that already has accents alone", () => {
    expect(accentVariants("PokéStop")).toEqual([]);
  });
});

describe("lookupCard accent fallback", () => {
  it("finds PokéStop when the asker typed PokeStop", async () => {
    const { calls } = stubSearch({ "PokéStop": pokeStop, "PokémonStop": [] });
    const lookup = await lookupCard(new TcgdexClient({ retries: 0 }), "PokeStop");
    expect(lookup?.card.id).toBe("swsh10.5-068");
    expect(calls.some((url) => url.includes("name=Pok%C3%A9Stop"))).toBe(true);
  });

  it("keeps the literal search when it answers", async () => {
    const { calls } = stubSearch({ Slowpoke: [{ id: "sv01-042", name: "Slowpoke", localId: "042" }] });
    const lookup = await lookupCard(new TcgdexClient({ retries: 0 }), "Slowpoke");
    expect(lookup?.card.id).toBe("sv01-042");
    expect(calls.some((url) => url.includes("name=Slowpok%C3%A9"))).toBe(false);
  });

  it("still reports nothing when the accented names do not match either", async () => {
    stubSearch({});
    await expect(lookupCard(new TcgdexClient({ retries: 0 }), "Zzznotacard")).resolves.toBeUndefined();
  });
});
