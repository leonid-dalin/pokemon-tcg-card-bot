import { describe, expect, it } from "vitest";
import type { TextGroup } from "../src/text-search.js";
import { categoryOf, filterGroups, filterOptions, groupCounts } from "../src/search-filter.js";

const group = (id: string, name: string, category?: string): TextGroup => ({
  representative: { id, name, text: "text", ...(category ? { category } : {}) },
  printings: 1,
});

const groups: TextGroup[] = [
  group("sv01-001", "Bulbasaur", "Pokemon"),
  group("sv02-185", "Iono", "Trainer"),
  group("sve-005", "Basic {P} Energy", "Energy"),
  group("b4b-133", "Crustle ex", "Pokemon"),
  group("b1a-001", "Professor's Research", "Trainer"),
];

describe("filterGroups", () => {
  it("keeps everything for the all filter", () => {
    expect(filterGroups(groups, "all")).toHaveLength(5);
  });

  it("keeps only cards of the chosen category", () => {
    expect(filterGroups(groups, "Pokemon").map((g) => g.representative.name)).toEqual(["Bulbasaur", "Crustle ex"]);
    expect(filterGroups(groups, "Trainer").map((g) => g.representative.name)).toEqual(["Iono", "Professor's Research"]);
    expect(filterGroups(groups, "Energy").map((g) => g.representative.name)).toEqual(["Basic {P} Energy"]);
  });

  it("keeps a card with no category recorded out of every narrow filter", () => {
    const unknown = [group("sv01-010", "Mystery")];
    expect(filterGroups(unknown, "all")).toHaveLength(1);
    expect(filterGroups(unknown, "Pokemon")).toHaveLength(0);
  });
});

describe("groupCounts", () => {
  it("counts each category", () => {
    expect(groupCounts(groups)).toEqual({ all: 5, Pokemon: 2, Trainer: 2, Energy: 1 });
  });
});

describe("filterOptions", () => {
  it("offers all plus every category with at least one card", () => {
    expect(filterOptions(groups)).toEqual(["all", "Pokemon", "Trainer", "Energy"]);
  });

  it("drops a category that would show nothing", () => {
    expect(filterOptions(groups.filter((g) => g.representative.category !== "Energy"))).toEqual(["all", "Pokemon", "Trainer"]);
  });

  it("offers no filters when nothing carries a category", () => {
    expect(filterOptions([group("sv01-001", "Legacy")])).toEqual(["all"]);
  });
});

describe("categoryOf", () => {
  it("reads the category a card carries", () => {
    expect(categoryOf(groups[1]!)).toBe("Trainer");
  });

  it("says nothing for a card built before categories were recorded", () => {
    expect(categoryOf(group("sv01-010", "Mystery"))).toBeUndefined();
  });
});
