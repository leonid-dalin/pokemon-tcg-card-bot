import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card } from "../src/api/types.js";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { parseDecklist } from "../src/decklist.js";
import { resolveDeckCards } from "../src/deck-check.js";

afterEach(() => vi.unstubAllGlobals());

const card = (id: string, name: string, overrides: Partial<Card> = {}): Card => ({
  id,
  name,
  localId: id.slice(id.lastIndexOf("-") + 1),
  ...overrides,
});

const deckOf = (rows: string[]) => parseDecklist(rows.join("\n"))!;

const FILLER = ["4 Arven SVI 166", "4 Nest Ball SVI 181", "4 Ultra Ball SVI 196", "4 Switch SVI 194"];

/**
 * Exact-path stub keyed on `path?name=` decoded, so two ids cannot blur into
 * each other and a `+` in the query is not mistaken for a literal.
 */
function stubExact(routes: Record<string, unknown>) {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    const name = url.searchParams.get("name");
    const key = name === null ? url.pathname : `${url.pathname}?name=${name}`;
    if (!(key in routes)) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    return { ok: true, status: 200, json: async () => routes[key] } as unknown as Response;
  });
}

describe("printed code resolves only a card with the line's name", () => {
  it("skips a candidate at that number carrying another card, then resolves by name", async () => {
    // TWM 130 is Dragapult ex; here the number belongs to another card.
    stubExact({
      "/v2/en/cards/sv06-130": card("sv06-130", "Something Else"),
      "/v2/en/cards?name=Dragapult ex": [
        { id: "sv08.5-073", name: "Dragapult ex", image: "https://assets.tcgdex.net/en/sv/sv08.5/073" },
        { id: "sv06-130", name: "Dragapult ex", image: "https://assets.tcgdex.net/en/sv/sv06/130" },
      ],
      "/v2/en/cards/sv08.5-073": card("sv08.5-073", "Dragapult ex"),
    });
    const resolved = await resolveDeckCards(new TcgdexClient({ retries: 0 }), deckOf(["3 Dragapult ex TWM 130", ...FILLER]));
    const line = resolved.find((entry) => entry.line.name === "Dragapult ex");
    expect(line?.card?.name).toBe("Dragapult ex");
    expect(line?.card?.id).not.toBe("sv06-130");
  });
});

describe("name fallback ties", () => {
  it("prefers a printing with artwork over a newer one without", async () => {
    stubExact({
      "/v2/en/cards?name=Melony": [
        { id: "swsh6-146", name: "Melony", image: "https://assets.tcgdex.net/en/swsh/swsh6/146" },
        { id: "swsh12-999", name: "Melony" },
      ],
      "/v2/en/cards/swsh6-146": card("swsh6-146", "Melony"),
    });
    const resolved = await resolveDeckCards(new TcgdexClient({ retries: 0 }), deckOf(["2 Melony ZZZ 1", ...FILLER]));
    expect(resolved.find((entry) => entry.line.name === "Melony")?.card?.id).toBe("swsh6-146");
  });

  it("prefers the newest set when both have artwork", async () => {
    stubExact({
      "/v2/en/cards?name=Melony": [
        { id: "swsh6-146", name: "Melony", image: "https://assets.tcgdex.net/en/swsh/swsh6/146" },
        { id: "sv06-170", name: "Melony", image: "https://assets.tcgdex.net/en/sv/sv06/170" },
      ],
      "/v2/en/cards/sv06-170": card("sv06-170", "Melony"),
    });
    const resolved = await resolveDeckCards(new TcgdexClient({ retries: 0 }), deckOf(["2 Melony ZZZ 1", ...FILLER]));
    // sv06 is a newer set than swsh6, so it wins once artwork ties.
    expect(resolved.find((entry) => entry.line.name === "Melony")?.card?.id).toBe("sv06-170");
  });
});
