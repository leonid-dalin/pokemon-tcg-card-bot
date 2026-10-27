import { describe, expect, it } from "vitest";
import { searchPocketByName } from "../src/api/pocket.js";

describe("searchPocketByName", () => {
  it.each(["Mewtwo", "Pikachu", "Professor's Research"])("lists each %s printing once", (name) => {
    const ids = searchPocketByName(name).map((card) => card.id);
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
