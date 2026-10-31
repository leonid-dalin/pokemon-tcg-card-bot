import { describe, expect, it, vi } from "vitest";
import { MAX_DECK_CALLS, resolveDeckCards } from "../src/deck-check.js";
import type { ParsedDeck } from "../src/decklist.js";

function deckOf(count: number, sameCard = false): ParsedDeck {
  return {
    lines: Array.from({ length: count }, (_, index) => ({
      count: 1,
      name: sameCard ? "Ultra Ball" : `Card Number${index}`,
      setCode: sameCard ? "SVI" : "SVI",
      number: sameCard ? "196" : String(100 + index),
    })),
    truncated: false,
  };
}

function countingClient() {
  const calls = { get: 0, search: 0 };
  return {
    calls,
    client: {
      getCard: async () => {
        calls.get += 1;
        return undefined;
      },
      searchByName: async () => {
        calls.search += 1;
        return [];
      },
    } as never,
  };
}

describe("deck resolution cost", () => {
  it("asks upstream once for repeated lines naming the same card", async () => {
    const { calls, client } = countingClient();

    const result = await resolveDeckCards(client, deckOf(9, true));

    // One card costs its two printed-id attempts plus a name fallback, once.
    expect(calls.get + calls.search).toBeLessThanOrEqual(3);
  });

  it("stops at the call budget however many distinct lines a deck has", async () => {
    const { calls, client } = countingClient();

    const result = await resolveDeckCards(client, deckOf(80));

    expect(calls.get + calls.search).toBeLessThanOrEqual(MAX_DECK_CALLS);
    expect(result.exhausted).toBe(true);
  });

  it("resolves a realistic 31-line list with padded ids inside the budget", async () => {
    const ids = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(3, "0"));
    const deck: ParsedDeck = {
      lines: ids.map((number, index) => ({ count: 1, name: `Card ${index}`, setCode: "SVI", number })),
      truncated: false,
    };
    const seen: string[] = [];
    const client = {
      getCard: async (id: string) => {
        seen.push(id);
        return { id, name: `Card ${ids.indexOf(id.split("-")[1] ?? "")}` };
      },
      searchByName: async () => [],
    } as never;

    const result = await resolveDeckCards(client, deck);

    expect(result.exhausted).toBe(false);
    expect(result.lines.filter((line) => line.card)).toHaveLength(31);
    expect(seen.length).toBeLessThanOrEqual(MAX_DECK_CALLS);
  });

  it("keeps a small deck well inside the budget", async () => {
    const small = countingClient();

    const result = await resolveDeckCards(small.client, deckOf(3));

    expect(small.calls.get + small.calls.search).toBeLessThanOrEqual(9);
    expect(result.exhausted).toBe(false);
  });
});

describe("a deck lookup that fails", () => {
  it("reports an outage instead of recording the line as unresolved", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = {
      getCard: async () => {
        throw Object.assign(new Error("upstream is down"), { status: 503 });
      },
      searchByName: async () => [],
    } as never;

    await resolveDeckCards(client, deckOf(1));

    expect(said).toHaveBeenCalled();
    said.mockRestore();
  });
});
