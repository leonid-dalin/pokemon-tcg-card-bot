import { describe, expect, it } from "vitest";
import { searchCardText, textIndexSize } from "../src/text-search.js";

describe("text index", () => {
  it("covers most of the catalogue", () => {
    expect(textIndexSize()).toBeGreaterThan(15000);
  });
});

describe("searchCardText", () => {
  it("finds a Pokemon attack by its wording, which the API cannot do", () => {
    const hits = searchCardText("Put a Trainer card from your discard pile into your hand");
    expect(hits.some((hit) => hit.id === "sv08-087")).toBe(true);
  });

  it("finds Trainer text too", () => {
    const hits = searchCardText("discard pile into your hand");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.name.length > 0)).toBe(true);
  });

  it("finds a stadium by its effect", () => {
    const hits = searchCardText("stadium");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("ignores case and accents", () => {
    const a = searchCardText("POKEMON");
    const b = searchCardText("pokémon");
    expect(a.map((hit) => hit.id)).toEqual(b.map((hit) => hit.id));
  });

  it("requires every word, so a single common word is not enough on its own", () => {
    const narrow = searchCardText("discard pile into your hand");
    const wider = searchCardText("discard");
    expect(wider.length).toBeGreaterThanOrEqual(narrow.length);
  });

  it("returns nothing for an empty or one-letter query", () => {
    expect(searchCardText("")).toEqual([]);
    expect(searchCardText("a")).toEqual([]);
  });

  it("finds a card whose own text never repeats its name", () => {
    const hits = searchCardText("Iono");
    expect(hits.some((hit) => hit.name === "Iono")).toBe(true);
  });

  it("ranks an exact name first", () => {
    const hits = searchCardText("Iono");
    expect(hits[0]?.name).toBe("Iono");
  });
});
