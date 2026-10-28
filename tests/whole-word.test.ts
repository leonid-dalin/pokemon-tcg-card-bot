import { describe, expect, it } from "vitest";
import { searchCardText } from "../src/text-search.js";

const names = (query: string) => searchCardText(query).map((hit) => hit.name);

describe("whole word matching", () => {
  it("does not match a short word inside a longer one", () => {
    // "and" inside "Sand Screen" used to count as a hit.
    const hits = searchCardText("opponent's deck and discard");
    expect(hits.some((hit) => hit.id === "sv03.5-027")).toBe(false);
  });

  it("still finds a card that prints every word", () => {
    const hits = searchCardText("opponent's deck and discard");
    expect(hits.some((hit) => hit.name === "Miss Fortune Sisters")).toBe(true);
  });

  it("treats a possessive as one word", () => {
    const hits = searchCardText("opponent's deck and discard");
    expect(hits.some((hit) => hit.name === "Miss Fortune Sisters")).toBe(true);
  });

  it("keeps an exact name first", () => {
    expect(names("Iono")[0]).toBe("Iono");
  });

  it("drops a word that only appears as part of another", () => {
    // `sand` finds Sandshrew, a word of its own; `nan` appears nowhere as a word.
    expect(searchCardText("sand").some((hit) => hit.name === "Sandshrew")).toBe(true);
    expect(searchCardText("nan").length).toBe(0);
  });

  it("finds a short word where a card really prints it", () => {
    // "and" is a real word in card text, so it is not banned, only bounded.
    expect(searchCardText("and").some((hit) => hit.name === "Wait and See Hammer")).toBe(true);
  });
});
