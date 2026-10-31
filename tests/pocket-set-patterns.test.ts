import { describe, expect, it } from "vitest";
import { footerFor } from "../src/discord/commands.js";
import { limitlessUrl } from "../src/links.js";
import { isPocketCardId, isPocketSet } from "../src/prizes.js";
import { printedNumber } from "../src/printed.js";
import { setIdOf } from "../src/resolve.js";

const ATTRIBUTION = "Card data from TCGdex";

/** Every Pocket-recognising consumer must agree about the same ids. */
const CASES: { id: string; pocket: boolean }[] = [
  { id: "a1-001", pocket: true },
  { id: "b2a-010", pocket: true },
  { id: "c1-001", pocket: true },
  { id: "c1-168", pocket: true },
  { id: "pa-001", pocket: true },
  { id: "pb-001", pocket: true },
  { id: "pc-001", pocket: true },
  { id: "p-a-001", pocket: true },
  { id: "p-c-001", pocket: true },
  { id: "sv1-001", pocket: false },
  { id: "swsh1-001", pocket: false },
  { id: "base1-4", pocket: false },
  { id: "swsh9tg-TG23", pocket: false },
  { id: "bw3-101", pocket: false },
];

describe("Pocket set recognition agrees everywhere", () => {
  it.each(CASES)("classifies $id as pocket=$pocket", ({ id, pocket }) => {
    expect(isPocketCardId(id), "isPocketCardId").toBe(pocket);
    expect(isPocketSet(setIdOf(id)), "isPocketSet").toBe(pocket);
  });

  it.each(CASES.filter((entry) => entry.pocket))("credits the package for $id", ({ id }) => {
    expect(footerFor([{ id }], ATTRIBUTION)).toContain("pokemon-tcg-pocket-cards");
  });

  it.each(CASES.filter((entry) => !entry.pocket))("keeps the TCGdex credit for $id", ({ id }) => {
    expect(footerFor([{ id }], ATTRIBUTION)).not.toContain("pokemon-tcg-pocket-cards");
  });

  it.each(CASES)("links $id to the right Limitless database", ({ id, pocket }) => {
    const url = limitlessUrl(id);
    if (pocket) expect(url).toMatch(/^https:\/\/pocket\.limitlesstcg\.com\/cards\//);
  });

  it("addresses the package C promo set the way Limitless does", () => {
    // Limitless serves P-C, not PC.
    expect(limitlessUrl("pc-001")).toBe("https://pocket.limitlesstcg.com/cards/P-C/1");
    expect(limitlessUrl("p-c-001")).toBe("https://pocket.limitlesstcg.com/cards/p-c/1");
  });

  it("keeps printing the package C sets as Pocket codes", () => {
    expect(printedNumber("c1-168")).toBe("C1 168");
    // Package promos display with the printed hyphen, matching the card face.
    expect(printedNumber("pc-001")).toBe("P-C 1");
  });
});
