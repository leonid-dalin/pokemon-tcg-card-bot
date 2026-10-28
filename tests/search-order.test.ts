import { describe, expect, it } from "vitest";
import { searchCardGroups } from "../src/text-search.js";
import { setRecency } from "../src/set-index.js";

const groups = (query: string) => searchCardGroups(query);

describe("result order", () => {
  it("puts the newest set first, not the shortest text", () => {
    const found = groups("bottom of their deck");
    expect(found.length).toBeGreaterThan(2);
    for (let i = 1; i < found.length; i += 1) {
      expect(setRecency(found[i - 1]!.representative.id)).toBeGreaterThanOrEqual(setRecency(found[i]!.representative.id));
    }
  });

  it("keeps an exact name match ahead of the newer sets", () => {
    expect(groups("Iono")[0]?.representative.name).toBe("Iono");
  });

  it("breaks a tie inside one set by relevance, so a name hit beats a wording hit", () => {
    const found = groups("deck");
    const newest = setRecency(found[0]!.representative.id);
    const sameSet = found.filter((group) => setRecency(group.representative.id) === newest);
    expect(sameSet.length).toBeGreaterThan(1);
    // Check text-length and name-match ordering within the same recency rank.
    const lengths = sameSet.map((group) => group.representative.text.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
    const nameHits = sameSet.map((group) => group.representative.name.toLowerCase().split(" ").filter((w) => "deck".includes(w)).length);
    expect(nameHits).toEqual([...nameHits].sort((a, b) => b - a));
  });

  it("orders the same query the same way twice", () => {
    expect(groups("discard a card").map((g) => g.representative.id)).toEqual(groups("discard a card").map((g) => g.representative.id));
  });
});
