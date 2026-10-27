import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TcgdexClient, TcgdexError } from "../src/api/tcgdex.js";
import type { Card } from "../src/api/types.js";
import { lookupCard, lookupEmbeds } from "../src/lookup.js";

const dragapult = JSON.parse(
  readFileSync(new URL("./fixtures/dragapult-ex-sv08.5-073.json", import.meta.url), "utf8"),
) as Card;

const summaries = [
  { id: "sv08.5-073", name: "Dragapult ex", localId: "073" },
  { id: "sv06-130", name: "Dragapult ex", localId: "130" },
];

interface StubRoute {
  status?: number;
  body: unknown;
}

function stubFetch(routes: Record<string, StubRoute | StubRoute[]>) {
  const calls: string[] = [];
  const queue = new Map(Object.entries(routes).map(([key, value]) => [key, Array.isArray(value) ? [...value] : [value]]));

  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((candidate) => url.includes(candidate));
    if (!key) {
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }
    const entries = queue.get(key) ?? [];
    const next = entries.length > 1 ? entries.shift() : entries[0];
    if (!next) throw new Error(`no stub left for ${url}`);
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => next.body,
    } as unknown as Response;
  });

  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TcgdexClient", () => {
  it("caches a card so repeat lookups do not hit the network", async () => {
    const { calls } = stubFetch({ "/cards/sv08.5-073": { body: dragapult } });
    const client = new TcgdexClient();
    await client.getCard("sv08.5-073");
    await client.getCard("sv08.5-073");
    expect(calls).toHaveLength(1);
  });

  it("retries a 5xx and succeeds", async () => {
    stubFetch({
      "/cards/sv08.5-073": [{ status: 500, body: {} }, { body: dragapult }],
    });
    const client = new TcgdexClient({ retries: 1 });
    await expect(client.getCard("sv08.5-073")).resolves.toMatchObject({ name: "Dragapult ex" });
  });

  it("raises a typed error on a missing card", async () => {
    stubFetch({ "/cards/nope-1": { status: 404, body: {} } });
    const client = new TcgdexClient();
    await expect(client.getCard("nope-1")).rejects.toBeInstanceOf(TcgdexError);
  });

  it("caps how many search results come back", async () => {
    stubFetch({ "/cards?name=": { body: summaries } });
    const client = new TcgdexClient();
    await expect(client.searchByName("Dragapult", 1)).resolves.toHaveLength(1);
  });
});

describe("lookupCard", () => {
  it("renders the best printing and keeps the rest as alternates", async () => {
    stubFetch({
      "/cards?name=": { body: summaries },
      "/cards/sv08.5-073": { body: dragapult },
    });
    const client = new TcgdexClient();
    const lookup = await lookupCard(client, "Dragapult ex");
    expect(lookup?.card.id).toBe("sv08.5-073");
    expect(lookup?.view.title).toBe("Dragapult ex · #073/131");
    expect(lookup?.alternates.map((card) => card.id)).toEqual(["sv06-130"]);
  });

  it("returns undefined when nothing matches in either source", async () => {
    const { calls } = stubFetch({ "/cards?name=": { body: summaries } });
    const client = new TcgdexClient();
    await expect(lookupCard(client, "Zzznotacard")).resolves.toBeUndefined();
    expect(calls.some((call) => call.includes("/cards/sv"))).toBe(false);
  });

  it("honours the set hint from a mention", async () => {
    stubFetch({
      "/cards?name=": { body: summaries },
      "/cards/sv06-130": { body: { ...dragapult, id: "sv06-130", localId: "130" } },
    });
    const client = new TcgdexClient();
    const lookup = await lookupCard(client, "Dragapult", "sv06");
    expect(lookup?.card.id).toBe("sv06-130");
  });

  it("keeps one embed and lists other printings as a field", async () => {
    stubFetch({
      "/cards?name=": { body: summaries },
      "/cards/sv08.5-073": { body: dragapult },
    });
    const client = new TcgdexClient();
    const lookup = await lookupCard(client, "Dragapult ex");
    const embeds = lookupEmbeds(lookup!);
    expect(embeds).toHaveLength(1);
    const printings = embeds[0]?.fields.find((field) => field.name === "Other printings");
    expect(printings?.value).toContain("sv06-130");
    expect(printings?.value).toContain("[[Dragapult ex|setId]]");
  });

  it("accepts a set name as the hint", async () => {
    stubFetch({
      "/cards?name=": {
        body: [
          { id: "sv08-144", name: "Snorlax", localId: "144", image: "https://assets.tcgdex.net/en/sv/sv08/144" },
          { id: "swsh10.5-055", name: "Snorlax", localId: "055", image: "https://assets.tcgdex.net/en/swsh/swsh10.5/55" },
        ],
      },
      "/sets": { body: [{ id: "swsh10.5", name: "Pokémon GO" }, { id: "sv08", name: "Surging Sparks" }] },
      "/cards/swsh10.5-055": { body: { ...dragapult, id: "swsh10.5-055", name: "Snorlax", localId: "055" } },
    });
    const client = new TcgdexClient();
    const lookup = await lookupCard(client, "Snorlax", "Pokemon GO");
    expect(lookup?.card.id).toBe("swsh10.5-055");
  });

  it("pins the set exactly so A1 does not match A1a", async () => {
    stubFetch({
      "/cards?name=": {
        body: [
          { id: "A1a-025", name: "Pikachu", localId: "025", image: "https://assets.tcgdex.net/en/tcgp/A1a/25" },
          { id: "A1-025", name: "Pikachu", localId: "025", image: "https://assets.tcgdex.net/en/tcgp/A1/25" },
        ],
      },
      "/cards/A1-025": { body: { ...dragapult, id: "A1-025", name: "Pikachu", localId: "025" } },
    });
    const client = new TcgdexClient();
    const lookup = await lookupCard(client, "Pikachu", "A1");
    expect(lookup?.card.id).toBe("A1-025");
  });

  it("keeps an exact name ahead of a newer series that only contains it", async () => {
    stubFetch({
      "/cards?name=": {
        body: [
          { id: "me02-013", name: "Mega Charizard X ex", localId: "013", image: "https://assets.tcgdex.net/en/me/me02/13" },
          { id: "sv03-125", name: "Charizard", localId: "125", image: "https://assets.tcgdex.net/en/sv/sv03/125" },
        ],
      },
      "/cards/sv03-125": { body: { ...dragapult, id: "sv03-125", name: "Charizard", localId: "125" } },
    });
    const client = new TcgdexClient();
    const lookup = await lookupCard(client, "Charizard");
    expect(lookup?.card.id).toBe("sv03-125");
  });

  it("prefers the newest series among art-bearing printings", async () => {
    stubFetch({
      "/cards?name=": {
        body: [
          { id: "pl4-1", name: "Charizard", localId: "1", image: "https://assets.tcgdex.net/en/pl/pl4/1" },
          { id: "sv03-125", name: "Charizard", localId: "125", image: "https://assets.tcgdex.net/en/sv/sv03/125" },
        ],
      },
      "/cards/sv03-125": { body: { ...dragapult, id: "sv03-125", name: "Charizard", localId: "125" } },
    });
    const client = new TcgdexClient();
    const lookup = await lookupCard(client, "Charizard");
    expect(lookup?.card.id).toBe("sv03-125");
  });

  it("answers a pocket hint from the bundled pocket data", async () => {
    const client = new TcgdexClient();
    const lookup = await lookupCard(client, "Crustle ex", "ptcgp");
    expect(lookup?.card.id).toBe("b4b-133");
    expect(lookup?.view.fields.find((field) => field.name === "Set")?.value).toContain("Deluxe Pack: Mega");
    expect(lookup?.view.fields.find((field) => field.name === "Attack")?.value).toContain("Boulder Crush");
    expect(lookup?.view.fields.some((field) => field.name === "Legal")).toBe(false);
    expect(lookup?.view.footer).toContain("pokemon-tcg-pocket-cards");
    expect(lookup?.view.footer).not.toContain("TCGdex");
  });

  it("prefers a printing with art over a newer one without", async () => {
    stubFetch({
      "/cards?name=": {
        body: [
          { id: "sv08-050", name: "Pikachu", localId: "050" },
          { id: "sv06-051", name: "Pikachu", localId: "051", image: "https://assets.tcgdex.net/en/sv/sv06/051" },
        ],
      },
      "/sets/sv08": { body: { id: "sv08", name: "Surging Sparks", releaseDate: "2024-11-08" } },
      "/sets/sv06": { body: { id: "sv06", name: "Twilight Masquerade", releaseDate: "2024-05-24" } },
      "/cards/sv06-051": { body: { ...dragapult, id: "sv06-051", name: "Pikachu", localId: "051" } },
    });
    const client = new TcgdexClient();
    const lookup = await lookupCard(client, "Pikachu");
    expect(lookup?.card.id).toBe("sv06-051");
  });
});
