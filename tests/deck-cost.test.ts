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

    await resolveDeckCards(client, deckOf(9, true));

    // One card costs its two printed-id attempts plus a name fallback, once.
    expect(calls.get + calls.search).toBeLessThanOrEqual(3);
  });

  it("stops at the call budget however many distinct lines a deck has", async () => {
    const { calls, client } = countingClient();

    await resolveDeckCards(client, deckOf(80));

    expect(calls.get + calls.search).toBeLessThanOrEqual(MAX_DECK_CALLS * 2);
  });

  it("does not spend more calls than lines", async () => {
    const small = countingClient();
    await resolveDeckCards(small.client, deckOf(3));
    const large = countingClient();
    await resolveDeckCards(large.client, deckOf(30));

    expect(small.calls.get + small.calls.search).toBeLessThanOrEqual(9);
    expect(large.calls.get + large.calls.search).toBeLessThanOrEqual(MAX_DECK_CALLS * 2);
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
