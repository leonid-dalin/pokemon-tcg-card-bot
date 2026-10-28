import { describe, expect, it } from "vitest";
import { searchCardText, searchCardGroups, matchingSentence } from "../src/text-search.js";

const wholeWord = (hay: string, word: string) => new RegExp(`(^|[^a-z0-9])${word}($|[^a-z0-9])`, "i").test(hay);

describe("punctuation in a query", () => {
  it("ignores a trailing full stop", () => {
    expect(searchCardText("discard a card.").length).toBe(searchCardText("discard a card").length);
  });

  it("splits a hyphenated word like the card text does", () => {
    const hyphen = searchCardText("Buddy-Buddy Poffin");
    const spaced = searchCardText("Buddy Buddy Poffin");
    expect(hyphen.length).toBeGreaterThan(0);
    expect(hyphen.map((h) => h.id)).toEqual(spaced.map((h) => h.id));
  });

  it("finds a card through a typographic apostrophe", () => {
    expect(searchCardText("opponent’s hand").map((h) => h.id)).toEqual(searchCardText("opponent's hand").map((h) => h.id));
  });

  it("highlights both halves of a hyphenated card name", () => {
    expect(matchingSentence("Search your deck for Buddy-Buddy Poffin.", "buddy-buddy")).toContain("**Buddy**-**Buddy**");
  });
});

describe("quoted phrase with a one-letter word", () => {
  it("keeps the article in the phrase", () => {
    const found = searchCardGroups(`"attach a basic energy"`);
    expect(found.length).toBeGreaterThan(0);
  });

  it("matches only where the words are adjacent", () => {
    for (const group of searchCardGroups(`"attach a basic energy"`)) {
      const flat = group.representative.text.replace(/[^a-z0-9 ]/gi, " ").toLowerCase().replace(/\s+/g, " ");
      expect(flat).toContain("attach a basic energy");
    }
  });

  it("does not match a phrase that only appears inside longer words", () => {
    const found = searchCardGroups(`"and a"`);
    for (const group of found) {
      expect(wholeWord(group.representative.text, "and")).toBe(true);
    }
  });
});

describe("every word search result prints its words", () => {
  it("returns only cards that carry and as a whole word", () => {
    const hits = searchCardText("and");
    expect(hits.length).toBeGreaterThan(0);
    const offenders = hits.filter((hit) => !wholeWord(hit.text, "and") && !wholeWord(hit.name, "and"));
    expect(offenders.map((hit) => `${hit.id} ${hit.name}`)).toEqual([]);
  });

  it("keeps Copycat, which prints hand rather than and", () => {
    expect(searchCardText("hand").some((hit) => hit.name === "Copycat")).toBe(true);
  });
});
