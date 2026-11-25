import { describe, expect, it } from "vitest";
import { setRecency } from "../src/set-index.js";
import { searchCardGroups } from "../src/text-search.js";

describe("A5 grouped search keeps the newest indexed representative", () => {
  it("ranks an indexed Pocket set by release date rather than a fallback score", () => {
    const newer = setRecency("B1-321");
    const older = setRecency("A2b-022");
    expect(newer).toBeGreaterThan(older);
    expect(older).toBeGreaterThan(-1000);
  });

  it("selects the newer indexed printing for a shared Pocket name", () => {
    const groups = searchCardGroups("Pikachu ex", "pocket");
    const representative = groups[0]!.representative.id;
    expect(representative).not.toBe("A2b-022");
    expect(new Set(["B1-321", "A4b-131", "A4b-364"]).has(representative.toUpperCase())).toBe(true);
  });
});
