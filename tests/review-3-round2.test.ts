import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Card } from "../src/api/types.js";
import { cardmarketAverage, priceField } from "../src/render.js";
import { getPocketCard } from "../src/api/pocket.js";
import { printingsOf } from "../src/printings.js";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import { LIST_CAP, PageStore, listReply } from "../src/discord/pages.js";
import { searchReply } from "../src/discord/replies.js";

const evidence = JSON.parse(readFileSync("tests/fixtures/pr3-evidence.json", "utf8"));

describe("nested tcgplayer market price", () => {
  it("renders the nested market price when flat averages are absent", () => {
    const card: Card = {
      id: "test-1",
      name: "Test",
      pricing: { tcgplayer: { normal: { marketPrice: 0.15 }, holo: { marketPrice: 0.4 } } },
    };
    const field = priceField(card);
    expect(field?.value).toContain("TCGplayer");
    expect(field?.value).toMatch(/€0\.1[0-9]/);
  });

  it("prefers flat averages when the record carries them", () => {
    const card: Card = {
      id: "test-2",
      name: "Test",
      pricing: { tcgplayer: { unit: "USD", avg: 2, normal: { marketPrice: 0.15 } } },
    };
    const field = priceField(card);
    expect(field?.value).toContain("TCGplayer");
    expect(field?.value).toMatch(/€1\.[0-9]{2}/);
    expect(field?.value).not.toContain("0.15");
  });

  it("stays silent when neither shape carries a figure", () => {
    expect(priceField({ id: "t", name: "T", pricing: { tcgplayer: { normal: { marketPrice: null } } } } as Card)).toBeUndefined();
  });
});

describe("uppercase pocket ids", () => {
  it("resolves a differently cased pocket id against the package", () => {
    expect(getPocketCard("a1-036")?.name).toBe("Charizard ex");
    expect(getPocketCard("A1-036")?.name).toBe("Charizard ex");
  });

  it("dates a pocket printing that arrives with source casing", async () => {
    const client = { searchByName: async () => [{ id: "A1-036", name: "Charizard ex" }] } as unknown as TcgdexClient;
    const printings = await printingsOf(client, "Charizard ex");
    const row = printings.find((printing) => printing.id.toLowerCase() === "a1-036");
    expect(row?.setLabel).toContain("Genetic Apex");
  });

  it("keeps the switch card priced through its recorded shape", () => {
    expect(evidence.switchCard.pricing.tcgplayer).toBeNull();
  });
});

describe("all-view display cap", () => {
  const group = (index: number, name: string, category: string) => ({
    representative: { id: `t-${String(index).padStart(4, "0")}`, name, text: "does things", category },
    printings: 1,
  });
  const universe = [
    ...Array.from({ length: 260 }, (_, i) => group(i, `Battler ${i + 1}`, "Pokemon")),
    ...Array.from({ length: 30 }, (_, i) => group(260 + i, `Tool ${i + 1}`, "Trainer")),
  ];

  it("caps the all view while categories keep their rows", () => {
    const pages = new PageStore();
    const reply = searchReply("does", universe, "Source", "owner", pages) as {
      components?: { toJSON: () => { components: { custom_id?: string } }[] }[];
    };
    const token = filterTokenFrom(reply.components![1]!.toJSON().components[0]!.custom_id!);
    const all = listReply(pages.get(token!)!, token!, 0);
    const allItems = (all.embeds[0]!.data.description ?? "").split("\n").filter((line) => line.includes(" · "));
    expect(allItems).toHaveLength(5);
    expect(LIST_CAP).toBe(250);
    const trainer = listReply(pages.get(token!)!, token!, 0, "Trainer");
    const trainerItems = (trainer.embeds[0]!.data.description ?? "").split("\n").filter((line) => line.includes(" · "));
    expect(trainerItems[0]).toContain("Tool 1");
  });
});

function filterTokenFrom(customId: string): string | undefined {
  return customId.startsWith("filter:") ? customId.slice("filter:".length) : undefined;
}
