import { describe, expect, it } from "vitest";
import type { CardLookup } from "../lookup.js";
import { cardReply } from "../src/discord/replies.js";
import { cardmarketRow } from "../src/discord/printing-buttons.js";
import { parseDecklist } from "../src/decklist.js";
import { resolveDeckCards } from "../src/deck-check.js";
import type { Card } from "../src/api/types.js";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { afterEach, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

const lookup: CardLookup = {
  card: { id: "sv01-181", name: "Nest Ball", image: "https://example.test/nest.webp" },
  alternates: [],
};

const labels = (reply: ReturnType<typeof cardReply>) =>
  reply.components?.flatMap((row) => row.toJSON().components.map((c) => (c as { label?: string }).label)) ?? [];

describe("cardReply listing links", () => {
  it("carries Limitless beside Details, with Cardmarket reserved for the details embed", () => {
    expect(labels(cardReply(lookup))).toEqual(["Details", "Limitless"]);
  });

  it("carries Limitless for a pocket card too", () => {
    const pocket: CardLookup = { card: { id: "A1-001", name: "Bulbasaur", image: "https://example.test/b.webp" }, alternates: [] };
    expect(labels(cardReply(pocket))).toEqual(["Details", "Limitless"]);
  });

  it("gives the details embed a Cardmarket row for a physical card", () => {
    expect(cardmarketRow(lookup.card.id, lookup.card.name)).toBeDefined();
  });
});

describe("findHits with a single-letter query", () => {
  it("finds the card named N exactly", async () => {
    const { searchCardGroups } = await import("../src/text-search.js");
    const groups = searchCardGroups("N");
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((g) => g.representative.name === "N")).toBe(true);
  });

  it("keeps a quoted phrase with a one-letter word in its excerpt", async () => {
    const { searchCardGroups, matchingDetail } = await import("../src/text-search.js");
    const groups = searchCardGroups(`"attach a basic energy"`);
    expect(groups.length).toBeGreaterThan(0);
    const detail = matchingDetail(groups[0]!.representative, `"attach a basic energy"`);
    expect(detail).toContain("**a**");
  });
});

describe("resolveByName rejects a wrong-named card", () => {
  it("leaves a deck line unresolved when the only candidate has another name", async () => {
    const wrong = { id: "swsh1-181", name: "Rotom Bike", image: "x" } as unknown as Card;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.searchParams.get("name") === "Nest Ball") {
        return { ok: true, status: 200, json: async () => [wrong] } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });
    const deck = parseDecklist(["2 Nest Ball SVI 999", "4 Arven SVI 166", "4 Nest Ball SVI 181", "4 Ultra Ball SVI 196", "4 Switch SVI 194"].join("\n"))!;
    const resolved = await resolveDeckCards(new TcgdexClient(), deck);
    const nest = resolved.find((r) => r.line.name === "Nest Ball");
    expect(nest?.card).toBeUndefined();
  });
});
