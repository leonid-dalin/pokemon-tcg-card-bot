import { describe, expect, it } from "vitest";
import { isPrintingOf } from "../src/resolve.js";

describe("isPrintingOf", () => {
  it("matches a possessive owner prefix", () => {
    expect(isPrintingOf("ho-oh ex", "Ethan's Ho-Oh ex")).toBe(true);
    expect(isPrintingOf("garchomp ex", "Cynthia's Garchomp ex")).toBe(true);
    expect(isPrintingOf("zoroark ex", "N's Zoroark ex")).toBe(true);
  });

  it("treats a possessive word on its own as a prefix only", () => {
    expect(isPrintingOf("garchomp ex", "Cynthia Garchomp ex")).toBe(false);
  });

  it("matches the same name in another case", () => {
    expect(isPrintingOf("ho-oh ex", "Ho-Oh EX")).toBe(true);
    expect(isPrintingOf("ho-oh ex", "Ho-Oh GX")).toBe(false);
  });

  it("matches a mechanic prefix", () => {
    expect(isPrintingOf("charizard", "Mega Charizard X ex")).toBe(true);
    expect(isPrintingOf("charizard", "Radiant Charizard")).toBe(true);
    expect(isPrintingOf("moltres", "Team Rocket's Moltres ex")).toBe(true);
  });

  it("splits a hyphen-attached mechanic", () => {
    expect(isPrintingOf("moltres", "Moltres-EX")).toBe(true);
    expect(isPrintingOf("moltres", "Moltres-GX")).toBe(true);
  });

  it("treats a mechanic suffix the query named as part of the name", () => {
    expect(isPrintingOf("charizard ex", "Charizard VMAX")).toBe(false);
    expect(isPrintingOf("charizard vmax", "Charizard VMAX")).toBe(true);
  });

  it("will not swap a Mega letter", () => {
    expect(isPrintingOf("mega charizard x ex", "Mega Charizard Y ex")).toBe(false);
    expect(isPrintingOf("mega charizard x ex", "Mega Charizard X ex")).toBe(true);
  });

  it("compares words whole, not as substrings", () => {
    expect(isPrintingOf("mew", "Mewtwo")).toBe(false);
    expect(isPrintingOf("mew", "Mew")).toBe(true);
  });

  it("rejects an extra word", () => {
    expect(isPrintingOf("charizard", "Charizard Spirit Link")).toBe(false);
    expect(isPrintingOf("charizard", "Charizard & Braixen-GX")).toBe(false);
    expect(isPrintingOf("charizard", "Charizard ex")).toBe(true);
  });

  it("rejects a regional form", () => {
    expect(isPrintingOf("moltres", "Galarian Moltres V")).toBe(false);
    expect(isPrintingOf("galarian moltres", "Galarian Moltres V")).toBe(true);
  });

  it("rejects a combined card", () => {
    expect(isPrintingOf("moltres", "Moltres & Zapdos & Articuno GX")).toBe(false);
  });

  it("never matches an empty query", () => {
    expect(isPrintingOf("", "Charizard")).toBe(false);
  });
});
