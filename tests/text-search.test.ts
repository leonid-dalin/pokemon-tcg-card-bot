import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normaliseName } from "../src/resolve.js";
import { searchCardGroups, searchCardText, matchingSentence, textIndexSize } from "../src/text-search.js";

describe("text index", () => {
  it("covers most of the catalogue", () => {
    expect(textIndexSize()).toBeGreaterThan(15000);
  });
});

describe("searchCardText", () => {
  it("groups all printings by normalised card name", () => {
    const groups = searchCardGroups("draw 2 cards");
    const hits = searchCardText("draw 2 cards");
    const expected = new Set(hits.map((hit) => normaliseName(hit.name)));
    expect(groups.length).toBe(expected.size);
  });

  it("groups the three identical Team Rocket's Transceiver printings", () => {
    const group = searchCardGroups("search your deck for a supporter").find((entry) => entry.representative.name === "Team Rocket's Transceiver");
    expect(group).toMatchObject({ printings: 3, representative: { id: "me02.5-209" } });
  });

  it("returns one group per normalised card name", () => {
    const groups = searchCardGroups("discard pile into your hand");
    const names = groups.map((group) => normaliseName(group.representative.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it("uses the newest printing even when its text differs", () => {
    const group = searchCardGroups("discard pile into your hand").find((entry) => entry.representative.name === "VS Seeker");
    expect(group?.representative.id).toBe("xy6-110");
    expect(group?.printings).toBe(4);
  });
  it("selects the sentence with the most query words and marks matches", () => {
    expect(matchingSentence(
      "Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.",
      "supporter",
    )).toBe("Search your deck for a **Supporter** card, reveal it, and put it into your hand.");
  });

  it("cuts a long matching sentence at a word boundary", () => {
    const result = matchingSentence(`Search your deck for a Supporter ${"card ".repeat(50)}`, "supporter");
    expect(result.length).toBeLessThanOrEqual(160);
    expect(result.endsWith("…")).toBe(true);
  });

  it("keeps exact-name ranking first", () => {
    expect(searchCardGroups("Iono")[0]?.representative.name).toBe("Iono");
  });

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

  it("retains the legacy top hit for Iono", () => {
    expect(searchCardGroups("Iono")[0]?.representative.name).toBe("Iono");
  });
});
