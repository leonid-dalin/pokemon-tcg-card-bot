import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card } from "../src/api/types.js";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { parseDecklist } from "../src/decklist.js";
import { resolveDeckCards, type ResolvedLine } from "../src/deck-check.js";
import { cardmarketAverage, renderDecklist } from "../src/render.js";

interface StubRoute {
  status?: number;
  body: unknown;
}

/** A fetch stub keyed on a path fragment; the first key the URL contains wins. */
function stubFetch(routes: Record<string, StubRoute>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((candidate) => url.includes(candidate));
    if (!key) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    const route = routes[key]!;
    return { ok: true, status: 200, json: async () => route.body } as unknown as Response;
  });
  return { calls };
}

function card(id: string, name: string, overrides: Partial<Card> = {}): Card {
  return { id, name, localId: id.slice(id.lastIndexOf("-") + 1), ...overrides };
}

function pricedValue(avg: number): Partial<Card> {
  return { variants_detailed: [{ pricing: { cardmarket: { unit: "EUR", avg } } }] };
}

const deckOf = (rows: string[]) => parseDecklist(rows.join("\n"))!;

afterEach(() => vi.unstubAllGlobals());

const FILLER = ["4 Arven SVI 166", "4 Iono PAL 185", "4 Nest Ball SVI 181", "4 Ultra Ball SVI 196"];

/** Resolved rows for a deck, from a name to card table. */
function rowsFor(deck: ReturnType<typeof deckOf>, cards: Record<string, Card>): ResolvedLine[] {
  return deck.lines.map((line) => ({
    line,
    ...(cards[line.name] ? { card: cards[line.name]! } : {}),
  }));
}

describe("resolveDeckCards", () => {
  it("resolves a line through its unpadded id", async () => {
    const { calls } = stubFetch({ "/cards/sv06-128": { body: card("sv06-128", "Dreepy") } });
    const deck = deckOf(["4 Dreepy TWM 128", ...FILLER]);
    const resolved = await resolveDeckCards(new TcgdexClient({ retries: 0 }), deck);
    expect(resolved.find((entry) => entry.line.name === "Dreepy")?.card?.id).toBe("sv06-128");
    expect(calls.some((url) => url.endsWith("/cards/sv06-128"))).toBe(true);
  });

  it("resolves a line through the padded id", async () => {
    stubFetch({ "/cards/sve-005": { body: card("sve-005", "Basic {P} Energy") } });
    const deck = deckOf(["8 Basic {P} Energy SVE 5", ...FILLER]);
    const resolved = await resolveDeckCards(new TcgdexClient({ retries: 0 }), deck);
    expect(resolved.find((entry) => entry.line.name === "Basic {P} Energy")?.card?.id).toBe("sve-005");
  });

  it("falls back to a name search when the code names no set", async () => {
    const { calls } = stubFetch({
      "/cards?name=": { body: [{ id: "swsh6-146", name: "Melony", localId: "146", image: "https://assets.tcgdex.net/en/swsh/swsh6/146" }] },
      "/cards/swsh6-146": { body: card("swsh6-146", "Melony") },
    });
    const deck = deckOf(["2 Melony ZZZ 1", ...FILLER]);
    const resolved = await resolveDeckCards(new TcgdexClient({ retries: 0 }), deck);
    expect(resolved.find((entry) => entry.line.name === "Melony")?.card?.id).toBe("swsh6-146");
    expect(calls.some((url) => url.includes("name=Melony"))).toBe(true);
  });

  it("resolves a printed code whose set id is not its card id prefix", async () => {
    const { calls } = stubFetch({ "/cards/sv01-196": { body: card("sv01-196", "Ultra Ball") } });
    const deck = deckOf(["4 Ultra Ball SVI 196", "4 Arven SVI 166", "4 Iono PAL 185", "4 Nest Ball SVI 181", "4 Switch SVI 194"]);
    const resolved = await resolveDeckCards(new TcgdexClient({ retries: 0 }), deck);
    expect(resolved.find((entry) => entry.line.name === "Ultra Ball")?.card?.id).toBe("sv01-196");
    expect(calls.some((url) => url.endsWith("/cards/svi-196"))).toBe(false);
  });

  it("resolves at most four lines at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      const id = url.split("/cards/")[1] ?? "";
      return { ok: true, status: 200, json: async () => card(id, id) } as unknown as Response;
    });
    await resolveDeckCards(
      new TcgdexClient({ retries: 0 }),
      deckOf(["2 Arven SVI 166", "2 Iono PAL 185", "2 Nest Ball SVI 181", "2 Ultra Ball SVI 196", "2 Switch SVI 194", ...FILLER]),
    );
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe("decklist checks", () => {
  /** Six distinct lines, so a paste reads as a deck and the count field stays out of the way. */
  const TRAINERS = [
    "4 Arven SVI 166",
    "4 Iono PAL 185",
    "4 Nest Ball SVI 181",
    "4 Ultra Ball SVI 196",
    "4 Switch SVI 194",
    "4 Super Rod PAL 188",
  ];

  it("lists a card that is not Standard legal", () => {
    const deck = deckOf(TRAINERS);
    const rows = rowsFor(deck, { Iono: card("sv02-185", "Iono", { legal: { standard: false, expanded: true } }) });
    const reply = renderDecklist(deck, rows);
    expect(reply.fields.find((field) => field.name === "Not Standard legal")?.value).toBe("4 Iono (PAL 185)");
    expect(reply.fields.filter((field) => field.name === "Not Standard legal")).toHaveLength(1);
  });

  it("prices the deck from the Cardmarket average", () => {
    const deck = deckOf(TRAINERS);
    const rows = rowsFor(deck, {
      Arven: card("sv01-166", "Arven"),
      Iono: card("sv02-185", "Iono"),
      "Nest Ball": card("sv01-181", "Nest Ball"),
      "Ultra Ball": card("sv01-196", "Ultra Ball", pricedValue(1.25)),
      Switch: card("sv01-194", "Switch", pricedValue(0.5)),
    });
    const reply = renderDecklist(deck, rows);
    expect(reply.fields.find((field) => field.name === "Deck price")?.value).toBe(
      "≈ 7.00 EUR (Cardmarket average, 8 of 24 cards priced)",
    );
  });

  it("lowers the priced figure for a line with no price", () => {
    const deck = deckOf(TRAINERS);
    const rows = rowsFor(deck, { Iono: card("sv02-185", "Iono", pricedValue(2)) });
    const reply = renderDecklist(deck, rows);
    expect(reply.fields.find((field) => field.name === "Deck price")?.value).toBe(
      "≈ 8.00 EUR (Cardmarket average, 4 of 24 cards priced)",
    );
  });

  it("leaves basic Energy out of the legality check and the price", () => {
    const deck = deckOf([...TRAINERS, "4 Fire Energy SVE 2"]);
    const energy = card("sve-002", "Fire Energy", {
      category: "Energy",
      legal: { standard: false, expanded: true },
      ...pricedValue(9),
    });
    const rows = rowsFor(deck, { "Fire Energy": energy });
    const reply = renderDecklist(deck, rows);
    expect(reply.fields.find((field) => field.name === "Not Standard legal")).toBeUndefined();
    expect(reply.fields.find((field) => field.name === "Deck price")).toBeUndefined();
  });

  it("keeps the list and the count when there is no check", () => {
    const deck = deckOf(TRAINERS);
    const reply = renderDecklist(deck);
    expect(reply.fields.map((field) => field.name)).toEqual(["Cards", "Count"]);
    expect(reply.description).toContain("4 Iono (PAL 185)");
  });
});

describe("cardmarketAverage", () => {
  it("reads the first variant that carries a Cardmarket price", () => {
    expect(cardmarketAverage(card("sv02-185", "Iono", pricedValue(1.49)))).toBe(1.49);
    expect(cardmarketAverage(card("sv02-185", "Iono"))).toBeUndefined();
  });
});
