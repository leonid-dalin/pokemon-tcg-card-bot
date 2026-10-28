import { describe, expect, it } from "vitest";
import { getPocketCard, searchPocketByName } from "../src/api/pocket.js";

describe("searchPocketByName", () => {
  it.each(["Mewtwo", "Pikachu", "Professor's Research"])("lists each %s printing once", (name) => {
    const ids = searchPocketByName(name).map((card) => card.id);
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// Expected values read from pokemon-tcg-pocket-cards 5.4.0 on 2026-10-28:
// data/v5/pa/pa.gameplay.json (pa-007) and data/v5/b4/b4.collection.json, where
// b4-212 has no gameplay record and lists b4-070 as its alternate.
describe("getPocketCard", () => {
  it("reads a reprint's Trainer text from the printing that carries it", () => {
    const card = getPocketCard("a4b-373");
    expect(card?.category).toBe("Trainer");
    expect(card?.trainerType).toBe("Supporter");
    expect(card?.effect).toBe("Draw 2 cards.");
    expect(card?.types).toBeUndefined();
  });

  it("reads a reprint's attacks from the printing that carries them", () => {
    const reprint = getPocketCard("b4-212");
    const original = getPocketCard("b4-070");
    expect(original?.attacks?.length).toBeGreaterThan(0);
    expect(reprint?.hp).toBe(original?.hp);
    expect(reprint?.attacks).toEqual(original?.attacks);
  });

  // The adapter renders a supplied weakness type with a +20 modifier.
  it("gives a Pokémon its weakness type with the fixed +20", () => {
    expect(getPocketCard("b4-070")?.weaknesses).toEqual([{ type: "Darkness", value: "+20" }]);
  });
});
