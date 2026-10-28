import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card } from "../src/api/types.js";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { parseDecklist } from "../src/decklist.js";
import { resolveDeckCards } from "../src/deck-check.js";

afterEach(() => vi.unstubAllGlobals());

const FILLER = ["4 Arven SVI 166", "4 Nest Ball SVI 181", "4 Ultra Ball SVI 196", "4 Switch SVI 194"];
const deckOf = (rows: string[]) => parseDecklist(rows.join("\n"))!;

function stubExact(routes: Record<string, Card>) {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    const name = url.searchParams.get("name");
    const key = name === null ? url.pathname : `${url.pathname}?name=${name}`;
    if (!(key in routes)) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    return { ok: true, status: 200, json: async () => routes[key] } as unknown as Response;
  });
}

const energy = (id: string, name: string): Card => ({ id, name, localId: id.slice(id.lastIndexOf("-") + 1), category: "Energy" });

describe("basic Energy spellings", () => {
  it("resolves Basic {P} Energy to the set's Psychic Energy", async () => {
    stubExact({
      "/v2/en/cards/sve-005": energy("sve-005", "Psychic Energy"),
    });
    const resolved = await resolveDeckCards(new TcgdexClient({ retries: 0 }), deckOf(["8 Basic {P} Energy SVE 5", ...FILLER]));
    expect(resolved.find((entry) => entry.line.name === "Basic {P} Energy")?.card?.id).toBe("sve-005");
  });

  it("resolves Basic Psychic Energy to the same card", async () => {
    stubExact({
      "/v2/en/cards/sve-005": energy("sve-005", "Psychic Energy"),
    });
    const resolved = await resolveDeckCards(new TcgdexClient({ retries: 0 }), deckOf(["8 Basic Psychic Energy SVE 5", ...FILLER]));
    expect(resolved.find((entry) => entry.line.name === "Basic Psychic Energy")?.card?.id).toBe("sve-005");
  });

  it("still rejects a card at that number carrying a different name", async () => {
    stubExact({
      "/v2/en/cards/sv06-130": { id: "sv06-130", name: "Something Else", localId: "130" } as Card,
      "/v2/en/cards?name=Dragapult ex": [
        { id: "sv08.5-073", name: "Dragapult ex", image: "x" },
      ] as never,
      "/v2/en/cards/sv08.5-073": { id: "sv08.5-073", name: "Dragapult ex" } as Card,
    });
    const resolved = await resolveDeckCards(new TcgdexClient({ retries: 0 }), deckOf(["3 Dragapult ex TWM 130", ...FILLER]));
    expect(resolved.find((entry) => entry.line.name === "Dragapult ex")?.card?.id).toBe("sv08.5-073");
  });

  it("does not treat two different types as the same card", async () => {
    stubExact({
      "/v2/en/cards/sve-001": energy("sve-001", "Grass Energy"),
    });
    const resolved = await resolveDeckCards(new TcgdexClient({ retries: 0 }), deckOf(["8 Basic {P} Energy SVE 1", ...FILLER]));
    expect(resolved.find((entry) => entry.line.name === "Basic {P} Energy")?.card).toBeUndefined();
  });
});
