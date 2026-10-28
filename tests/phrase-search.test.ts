import { describe, expect, it } from "vitest";
import { matchingSentence, searchCardGroups, searchCardText, unquote } from "../src/text-search.js";

const ids = (query: string) => searchCardText(query).map((hit) => hit.id);

describe("unquoted search", () => {
  it("matches the words in any order, anywhere", () => {
    expect(ids("discard opponent's deck").length).toBeGreaterThan(0);
    expect(ids("opponent's discard deck").length).toBe(ids("discard opponent's deck").length);
  });

  it("still refuses a word inside a longer one", () => {
    // Copycat prints hand, not "and"; a card printing only "hand" must not match.
    const hits = searchCardText("hand");
    expect(hits.some((hit) => hit.name === "Copycat")).toBe(true);
    const wholeWord = (hay: string, word: string) => new RegExp(`(^|[^a-z0-9])${word}($|[^a-z0-9])`, "i").test(hay);
    for (const hit of searchCardText("and")) {
      expect(wholeWord(hit.text, "and") || wholeWord(hit.name, "and")).toBe(true);
    }
  });
});

describe("quoted search", () => {
  it("requires the words in order as a phrase", () => {
    const phrase = ids(`"opponent's deck and discard"`);
    const loose = ids("opponent's deck and discard");
    expect(phrase.length).toBeGreaterThan(0);
    expect(phrase.length).toBeLessThan(loose.length);
  });

  it("finds the card that prints the phrase", () => {
    expect(ids(`"opponent's deck and discard"`)).toContain("swsh11-164");
  });

  it("drops a card that prints the words apart", () => {
    // Copycat prints all four words, but not in that order, so a phrase search excludes it.
    expect(ids(`"opponent's deck and discard"`)).not.toContain("ex15-73");
  });

  it("ignores the punctuation between words, as the phrase reads aloud", () => {
    // Miss Fortune Sisters prints "your opponent's deck and discard any number".
    expect(ids(`"deck and discard"`)).toContain("swsh11-164");
  });

  it("works without quotes around a single word", () => {
    expect(ids("ionomalone")).toEqual([]);
    expect(ids("Iono").length).toBeGreaterThan(0);
  });

  it("reads the phrase out of curly quotes too", () => {
    expect(unquote("\u201cdeck and discard\u201d")).toBe("deck and discard");
    expect(ids("\u201cdeck and discard\u201d")).toEqual(ids(`"deck and discard"`));
  });
});

describe("phrase detail line", () => {
  it("highlights the phrase in the sentence that holds it", () => {
    const group = searchCardGroups(`"deck and discard"`)[0]!;
    expect(matchingSentence(group.representative.text, "deck and discard")).toContain("**deck** **and** **discard**");
  });
});
