import { describe, expect, it } from "vitest";
import { searchCardGroups, searchGroupsIn, matchingDetail, searchCardText } from "../src/text-search.js";

describe("quoted excerpt selection", () => {
  it("explains Golisopod with the attack that prints the phrase", () => {
    const group = searchCardGroups('"during your next turn"').find((g) => g.representative.id === "me04-026");
    expect(group).toBeTruthy();
    const detail = matchingDetail(group!.representative, '"during your next turn"');
    expect(detail.startsWith("Attack · Boundless Power:")).toBe(true);
    expect(detail.replaceAll("**", "").toLowerCase()).toContain("during your next turn");
    expect(detail.length).toBeLessThanOrEqual(160);
  });

  it("keeps unordered scoring for an unquoted query", () => {
    const group = searchCardGroups("during your next turn").find((g) => g.representative.id === "me04-026");
    expect(group).toBeTruthy();
    expect(matchingDetail(group!.representative, "during your next turn").length).toBeGreaterThan(0);
  });
});

describe("quoted one-letter names", () => {
  const entries = [{ id: "bw2-92", name: "N", text: "Shuffle your hand into your deck.", category: "Trainer" }];

  it("finds the exact name through every wrapping quote pair", () => {
    expect(searchGroupsIn(entries, '"N"')).toHaveLength(1);
    expect(searchGroupsIn(entries, "'N'")).toHaveLength(1);
    expect(searchGroupsIn(entries, "\u201cN\u201d")).toHaveLength(1);
    expect(searchGroupsIn(entries, "\u2018N\u2019")).toHaveLength(1);
    expect(searchGroupsIn(entries, "N")).toHaveLength(1);
  });

  it("does not widen an unrelated one-letter query into a name search", () => {
    // Each result must contain X as a complete text or name word.
    for (const hit of searchCardText('"X"')) {
      expect(new RegExp("(^|[^a-z0-9])x($|[^a-z0-9])", "i").test(hit.text) || /(^|\s)x(\s|$)/i.test(hit.name)).toBe(true);
    }
  });
});
