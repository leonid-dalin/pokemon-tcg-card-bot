import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isCardId } from "../src/lookup.js";

const evidence = JSON.parse(readFileSync("tests/fixtures/pr3-evidence.json", "utf8"));

describe("card id grammar", () => {
  it("recognises the real lettered ids autocomplete offers", () => {
    expect(isCardId("swsh12.5gg-GG65")).toBe(true);
    expect(isCardId("swsh4.5sv-SV004")).toBe(true);
    expect(isCardId("swshp-SWSH020")).toBe(true);
  });

  it("still recognises the ordinary shapes", () => {
    expect(isCardId("sv01-181")).toBe(true);
    expect(isCardId("swsh12.5-017")).toBe(true);
    expect(isCardId("A1-001")).toBe(true);
    expect(isCardId("xyp-XY23")).toBe(true);
  });

  it("refuses a hyphenated card name", () => {
    expect(isCardId("Porygon-Z")).toBe(false);
    expect(isCardId("Buddy-Buddy Poffin")).toBe(false);
    expect(isCardId("N")).toBe(false);
  });

  it("recognises the recorded autocomplete card", () => {
    expect(isCardId(evidence.autocompleteCard.id)).toBe(true);
  });
});
