import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Card } from "../src/api/types.js";
import { isImageOnly, lookupEmbeds } from "../src/lookup.js";
import { DEFAULT_ATTRIBUTION, cardColour, priceField, renderCard, renderCardDetails, renderCardImage, renderSearchResults, renderSet } from "../src/render.js";

const fixture = (name: string): Card =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as Card;

const dragapult = fixture("dragapult-ex-sv08.5-073.json");
const charizard = fixture("charizard-ex-sv03-125.json");
const megaGallade = fixture("mega-gallade-ex-me04-048.json");

const fieldNames = (card: Card) => renderCard(card).fields.map((field) => field.name);

// Field values copied from https://api.tcgdex.net/v2/en/cards/sv02-185 on 2026-10-28.
const iono: Card = {
  id: "sv02-185",
  localId: "185",
  name: "Iono",
  category: "Trainer",
  trainerType: "Supporter",
  effect:
    "Each player shuffles their hand and puts it on the bottom of their deck. If either player put any cards on the bottom of their deck in this way, each player draws a card for each of their remaining Prize cards.",
};

describe("renderCard", () => {
  it("puts game information on the Mega Gallade ex front", () => {
    const view = renderCard(megaGallade);
    expect(view.description).toMatch(/^350 HP · Fighting · Stage 2 · from Kirlia/);
    expect(view.fields.map((field) => field.name)).toEqual(["[F]  Gale Slash  50+", "[FFC]  Marvelous Edge  240", "Weakness", "Retreat"]);
    expect(view.fields.find((field) => field.name === "Weakness")?.value).toBe("Psychic ×2");
    expect(view.fields.some((field) => ["Rarity", "Legal", "Illustrator"].includes(field.name))).toBe(false);
    expect(view.fields.map((field) => field.name)).not.toContain("Prices (Cardmarket)");
    expect(view.footer).toMatch(/^CRI 48 · Reg J/);
    expect(JSON.stringify(view)).not.toContain("—");
  });

  it("puts the compact energy token in the attack name", () => {
    const attacks = renderCard(megaGallade).fields.map((field) => field.name);
    expect(attacks).toContain("[F]  Gale Slash  50+");
    expect(attacks).toContain("[FFC]  Marvelous Edge  240");
  });
  it("uses configured energy emoji in the attack name", () => {
    const attacks = renderCard(megaGallade, { energyEmoji: { Fighting: "<:f:1>" } }).fields.map((field) => field.name);
    expect(attacks).toContain("<:f:1>  Gale Slash  50+");
    expect(attacks).toContain("<:f:1><:f:1>[C]  Marvelous Edge  240");
  });
  it("renders card details separately", () => {
    const view = renderCardDetails(megaGallade, [], { attribution: "Card data from TCGdex" });
    expect(view.fields.map((field) => field.name)).toEqual(["Set", "Rarity", "Illustrator", "Legal", "Prices (Cardmarket)"]);
    expect(view.fields.find((field) => field.name === "Set")?.value).toContain("Chaos Rising");
    expect(view.fields.find((field) => field.name === "Set")?.value).toContain("CRI 48");
  });

  it("renders an image-only card with the scan and nothing else", () => {
    const view = renderCardImage(dragapult);
    expect(view.fields).toEqual([]);
    expect(view.imageUrl).toBe("https://assets.tcgdex.net/en/sv/sv08.5/073/high.webp");
    expect(view.title).toBe("Dragapult ex · PRE 73");
    expect(view.footer).toBe("Card data from TCGdex · tcgdex.com");
    expect(view.url).toBe(view.imageUrl);
  });

  it("keeps the attribution on an image-only card", () => {
    const view = renderCardImage(dragapult, { attribution: "Card data from elsewhere" });
    expect(view.footer).toBe("Card data from elsewhere");
  });

  it("falls back to the full card when the printing has no scan", () => {
    const noScan: Card = { ...dragapult, image: undefined };
    const lookup = { card: noScan, alternates: [], imageOnly: true as const };
    expect(isImageOnly(lookup)).toBe(false);
    const view = lookupEmbeds(lookup)[0];
    expect(view.fields.length).toBeGreaterThan(0);
    expect(view.imageUrl).toBeUndefined();
  });

  it("shows the wording and the kind of a Trainer card", () => {
    const view = renderCard(iono);
    expect(view.description).toBe(iono.effect);
    expect(view.fields.find((field) => field.name === "Card")?.value).toBe("Trainer · Supporter");
  });

  it("titles the card with its name", () => {
    expect(renderCard(dragapult).title).toBe("Dragapult ex");
  });

  it("points the image at the high resolution art", () => {
    expect(renderCard(dragapult).imageUrl).toBe(
      "https://assets.tcgdex.net/en/sv/sv08.5/073/high.webp",
    );
  });

  it("colours the embed by the card type", () => {
    expect(cardColour(dragapult)).toBe(0xc0a000);
    expect(cardColour(charizard)).toBe(0x37474f);
  });

  it("carries the set, card profile and rarity in Details", () => {
    const view = renderCardDetails(dragapult, [], {});
    const set = view.fields.find((field) => field.name === "Set");
    const rarity = view.fields.find((field) => field.name === "Rarity");
    expect(set?.value).toContain("Prismatic Evolutions");
    expect(set?.value).toContain("PRE 73");
    expect(rarity?.value).toBe("Double rare");
  });

  it("renders each attack with its name, damage and effect", () => {
    const attacks = renderCard(dragapult).fields;
    expect(attacks.some((field) => field.name.endsWith("Jet Headbutt  70"))).toBe(true);
    expect(attacks.some((field) => field.name.endsWith("Phantom Dive  200"))).toBe(true);
    expect(attacks.find((field) => field.name.endsWith("Phantom Dive  200"))?.value).toContain("Put 6 damage counters");
  });

  it("lists every format the card is legal in on Details", () => {
    const legal = (card: Card) => renderCardDetails(card, [], {}).fields.find((field) => field.name === "Legal")?.value;
    expect(legal(dragapult)).toBe("Standard · Expanded");
    expect(legal(charizard)).toBe("Expanded");
  });

  it("summarises weakness and retreat as separate fields", () => {
    const fields = renderCard(charizard).fields;
    expect(fields.find((field) => field.name === "Weakness")?.value).toBe("Grass ×2");
    expect(fields.find((field) => field.name === "Retreat")?.value).toBe("2");
  });

  it("prices the card in the currency the source reports on Details", () => {
    const prices = renderCardDetails(dragapult, [], {}).fields.find((field) => field.name === "Prices (Cardmarket)")?.value;
    expect(prices).toContain("€1.49");
    expect(prices).toContain("€0.39");
    expect(prices).toMatch(/Updated \d{4}-\d{2}-\d{2}/);
  });

  it("attributes the data in the footer", () => {
    expect(renderCard(dragapult).footer).toContain("Card data from TCGdex");
  });

  it("omits the price field when the source has no pricing", () => {
    const bare: Card = { id: "x-1", name: "Bare", set: { id: "x", name: "Bare Set" } };
    expect(renderCard(bare).fields.map((field) => field.name)).not.toContain("Prices");
    expect(priceField(bare)).toBeUndefined();
  });

  it("shows both price sources when both are present", () => {
    const both: Card = {
      id: "y-1",
      name: "Both",
      variants_detailed: [
        {
          pricing: {
            cardmarket: { avg: 2.5, low: 1.5, unit: "EUR", updated: "2026-10-27T00:00:00.000Z" },
            tcgplayer: { avg: 3.25, low: 2, unit: "USD" },
          },
        },
      ],
    };
    const value = priceField(both)?.value ?? "";
    expect(value).toContain("€2.50");
    expect(value).toContain("TCGplayer");
  });

  it("keeps every field inside the Discord value limit", () => {
    const long: Card = {
      id: "z-1",
      name: "Long",
      attacks: [{ name: "Big", effect: "x".repeat(3000) }],
    };
    for (const field of renderCard(long).fields) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
    }
  });
});

describe("renderSet", () => {
  it("shows the card count and series", () => {
    const view = renderSet({
      id: "sv08.5",
      name: "Prismatic Evolutions",
      cardCount: { official: 131, total: 180 },
      serie: { id: "sv", name: "Scarlet & Violet" },
    });
    expect(view.title).toBe("Prismatic Evolutions");
    expect(view.fields.map((field) => field.name)).toContain("Cards");
    expect(view.fields.find((field) => field.name === "Series")?.value).toBe("Scarlet & Violet");
  });
});

describe("field composition", () => {
  it("does not emit empty fields", () => {
    for (const name of fieldNames(dragapult)) {
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

describe("footer credit", () => {
  const set = { id: "sv08.5", name: "Prismatic Evolutions" };
  const hits = [{ id: "sv02-185", name: "Iono" }];

  it("uses the configured attribution on set and search embeds", () => {
    expect(renderSet(set, "Data from somewhere").footer).toBe("Data from somewhere");
    expect(renderSearchResults("iono", hits, "Data from somewhere").footer).toBe("Data from somewhere");
  });

  it("falls back to the TCGdex credit", () => {
    expect(renderSet(set).footer).toBe(DEFAULT_ATTRIBUTION);
    expect(renderSearchResults("iono", hits).footer).toBe(DEFAULT_ATTRIBUTION);
  });
});
