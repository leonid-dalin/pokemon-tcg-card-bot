import { readFileSync } from "node:fs";
import type { Card } from "../../src/api/types.js";
import { TcgdexError, type TcgdexClient } from "../../src/api/tcgdex.js";

const captured = JSON.parse(
  readFileSync(new URL("./qa-offline-cards.json", import.meta.url), "utf8"),
) as { cards: Record<string, Card> };

/** Controlled TCGdex transport backed by captured real cards. No network is used. */
export function offlineClient(ids: string[], extra: Card[] = []): TcgdexClient {
  const byId = new Map<string, Card>();
  for (const [id, card] of Object.entries(captured.cards)) byId.set(id.toLowerCase(), card);
  for (const card of extra) byId.set(card.id.toLowerCase(), card);
  const summaries = ids
    .map((id) => byId.get(id.toLowerCase()))
    .filter((card): card is Card => Boolean(card))
    .map((card) => ({ id: card.id, name: card.name, localId: card.id.slice(card.id.lastIndexOf("-") + 1) }));
  return {
    searchByName: async () => summaries,
    getCard: async (id: string) => {
      const card = byId.get(id.toLowerCase());
      if (!card) throw new TcgdexError(`not found: ${id}`, 404);
      return card;
    },
  } as unknown as TcgdexClient;
}
