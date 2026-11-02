import { describe, expect, it } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import type { CardSummary } from "../src/api/types.js";
import { SET_INDEX } from "../src/data/set-index.js";
import { lookupCard } from "../src/lookup.js";
import { setIdMatches } from "../src/resolve.js";
import { setFamily } from "../src/set-index.js";

const summary = (id: string, name: string): CardSummary => ({ id, name, localId: id.slice(id.lastIndexOf("-") + 1), image: `https://img/${id}` }) as CardSummary;

const CARDS = [
  summary("swsh10tg-TG03", "Kingdra"),
  summary("swsh11-037", "Kingdra"),
  summary("swsh10-085", "Kleavor"),
  summary("swsh10tg-TG08", "Kleavor"),
];

/** Name search and card fetch over a fixed list; no network. */
const client = {
  searchByName: async (query: string) => CARDS.filter((card) => card.name.toLowerCase() === query.toLowerCase()),
  getCard: async (id: string) => {
    const card = CARDS.find((entry) => entry.id === id);
    if (!card) throw new Error(`unknown ${id}`);
    return { ...card, category: "Pokemon" };
  },
} as unknown as TcgdexClient;

describe("a main-set hint covers its gallery subsets", () => {
  it.each([["swsh10"], ["ASR"]])("finds the Trainer Gallery Kingdra for the hint %s", async (hint) => {
    const found = await lookupCard(client, "Kingdra", hint);
    expect(found?.card.id).toBe("swsh10tg-TG03");
  });

  it("keeps the main set's own card first and lists the gallery printing", async () => {
    const found = await lookupCard(client, "Kleavor", "swsh10");
    expect(found?.card.id).toBe("swsh10-085");
    expect(found?.alternates.map((card) => card.id)).toEqual(["swsh10tg-TG08"]);
  });

  it("keeps a subset hint to the subset alone", async () => {
    const found = await lookupCard(client, "Kleavor", "swsh10tg");
    expect(found?.card.id).toBe("swsh10tg-TG08");
    expect(found?.alternates).toEqual([]);
  });

  it("keeps a set without that card in its family to its own printing", async () => {
    const found = await lookupCard(client, "Kingdra", "swsh11");
    expect(found?.card.id).toBe("swsh11-037");
  });

  it("pairs every indexed subset with a main set whose partial match keeps it", () => {
    const subsets = SET_INDEX.filter((entry) => entry.code?.includes(":"));
    expect(subsets.length).toBeGreaterThan(0);
    for (const subset of subsets) {
      const parent = SET_INDEX.find((entry) => entry.code === subset.code!.split(":")[0]);
      expect(parent, subset.id).toBeDefined();
      expect(setFamily(parent!.id)).toContain(subset.id);
      expect(setIdMatches(`${subset.id}-1`, parent!.id)).toBe(true);
    }
  });
});
