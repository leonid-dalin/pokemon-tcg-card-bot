import { describe, expect, it } from "vitest";
import { searchCardGroups } from "../src/text-search.js";
import { isPocketCardId } from "../src/prizes.js";

/** Search honours the server's Card games setting, as card lookups do. */
describe("search respects the game scope", () => {
  it("returns only Pocket cards for a Pocket server", () => {
    const groups = searchCardGroups("energy", "pocket");
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) expect(isPocketCardId(group.representative.id), group.representative.id).toBe(true);
  });

  it("returns only physical cards for a physical server", () => {
    const groups = searchCardGroups("energy", "ptcg");
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) expect(isPocketCardId(group.representative.id), group.representative.id).toBe(false);
  });

  it("narrows the result set rather than returning both pools", () => {
    const both = searchCardGroups("energy", "both");
    const pocket = searchCardGroups("energy", "pocket");
    const physical = searchCardGroups("energy", "ptcg");
    expect(pocket.length).toBeLessThan(both.length);
    expect(physical.length).toBeLessThan(both.length);
  });

  it("keeps the default unfiltered for callers without a preference", () => {
    expect(searchCardGroups("energy")).toEqual(searchCardGroups("energy", "both"));
  });

  it("finds the same card in each game", () => {
    const pocket = searchCardGroups("Mew", "pocket").map((group) => group.representative.id);
    const physical = searchCardGroups("Mew", "ptcg").map((group) => group.representative.id);
    expect(pocket.length).toBeGreaterThan(0);
    expect(physical.length).toBeGreaterThan(0);
    expect(pocket.every((id) => isPocketCardId(id))).toBe(true);
    expect(physical.every((id) => !isPocketCardId(id))).toBe(true);
  });
});
