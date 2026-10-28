import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Card } from "../src/api/types.js";
import { cardmarketAverage, deckPrice, renderCardDetails } from "../src/render.js";

const evidence = JSON.parse(readFileSync("tests/fixtures/pr3-evidence.json", "utf8"));

describe("pricing selection", () => {
  it("reads a real card-level Cardmarket average when variants carry none", () => {
    const card = evidence.switchCard;
    expect(card.pricing.cardmarket.avg).toBe(0.07);
    expect(cardmarketAverage(card)).toBe(0.07);
    expect(deckPrice([{ line: { count: 4, name: "Switch" }, card }])).toBe(
      "≈ 0.28 EUR (Cardmarket average, 4 of 4 cards priced)",
    );
  });

  it("keeps a variant price ahead of the card-level figure", () => {
    const card: Card = {
      id: "test-1",
      name: "Test",
      pricing: { cardmarket: { unit: "EUR", avg: 1 } },
      variants_detailed: [{ pricing: { cardmarket: { unit: "EUR", avg: 0.5 } } }],
    };
    expect(cardmarketAverage(card)).toBe(0.5);
  });

  it("mixes sources instead of letting one hide the other", () => {
    const card: Card = {
      id: "test-2",
      name: "Test",
      pricing: { cardmarket: { unit: "EUR", avg: 1 } },
      variants_detailed: [{ pricing: { tcgplayer: { unit: "USD", avg: 2 } } }],
    };
    expect(cardmarketAverage(card)).toBe(1);
  });

  it("does not invent a price for a card that has none", () => {
    expect(cardmarketAverage({ id: "t", name: "T", pricing: { cardmarket: null } } as Card)).toBeUndefined();
    expect(cardmarketAverage({ id: "t", name: "T" } as Card)).toBeUndefined();
  });
});

describe("details set date", () => {
  it("shows the indexed release date when card.set carries none", () => {
    const card = evidence.dragapultCard;
    expect(card.set.releaseDate).toBeUndefined();
    const field = renderCardDetails(card, []).fields.find((field) => field.name === "Set");
    expect(field?.value).toContain(evidence.dragapultSetDate);
  });

  it("keeps a source-provided date first", () => {
    const card: Card = { id: "sv06-130", name: "Test", set: { id: "sv06", name: "Twilight Masquerade", releaseDate: "2024-05-24" } };
    const field = renderCardDetails(card, []).fields.find((field) => field.name === "Set");
    expect(field?.value).toContain("2024-05-24");
  });

  it("leaves an unknown set harmless", () => {
    const view = renderCardDetails({ id: "zzz-1", name: "Test", set: { id: "zzz", name: "Nowhere" } }, []);
    expect(view.fields.find((field) => field.name === "Set")?.value).toContain("Nowhere");
  });
});
