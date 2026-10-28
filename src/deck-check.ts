import type { Card } from "./api/types.js";
import type { TcgdexClient } from "./api/tcgdex.js";
import type { DeckLine, ParsedDeck } from "./decklist.js";
import { SET_INDEX } from "./data/set-index.js";
import { normaliseName, rankPrintings, scoreCandidate } from "./resolve.js";
import { setRecency } from "./set-index.js";

export interface ResolvedLine {
  line: DeckLine;
  /** Absent when the line names no card either source knows. */
  card?: Card;
}

/**
 * Lines resolve at most four at a time, so one pasted list does not open
 * dozens of connections at once.
 */
const RESOLVE_CONCURRENCY = 4;

const entryByCode = new Map(
  SET_INDEX.filter((entry) => entry.code).map((entry) => [normaliseName(entry.code as string), entry]),
);

/**
 * Resolve each decklist line to a card. Lines resolve at most four at a time so
 * one pasted list does not open dozens of connections at once.
 */
export async function resolveDeckCards(client: TcgdexClient, deck: ParsedDeck): Promise<ResolvedLine[]> {
  const resolved: ResolvedLine[] = [];
  for (let start = 0; start < deck.lines.length; start += RESOLVE_CONCURRENCY) {
    const batch = deck.lines.slice(start, start + RESOLVE_CONCURRENCY);
    const results = await Promise.all(batch.map(async (line): Promise<ResolvedLine> => {
      const card = await resolveLine(client, line);
      return card ? { line, card } : { line };
    }));
    resolved.push(...results);
  }
  return resolved;
}

async function resolveLine(client: TcgdexClient, line: DeckLine): Promise<Card | undefined> {
  if (line.setCode && line.number) {
    // A PTCGL code is the printed code, and the set index maps it to the card
    // id prefix. The set id is not always that prefix: SVI prints as sv01.
    const prefix = entryByCode.get(normaliseName(line.setCode))?.id ?? line.setCode;
    const bare = line.number.replace(/^0+(?=\d)/, "");
    const wanted = normaliseName(line.name);
    for (const candidate of [`${prefix}-${bare}`, `${prefix}-${bare.padStart(3, "0")}`]) {
      const card = await client.getCard(candidate).catch(() => undefined);
      // A printing a set reuses for another card would otherwise be accepted on
      // its number alone, so the name has to agree.
      if (card && normaliseName(card.name) === wanted) return card;
    }
  }
  return resolveByName(client, line.name);
}

/**
 * A fallback by name. The printed code can name a printing TCGdex does not
 * serve, so the name decides. A tie breaks on the name score, then on whether
 * the printing has artwork, then on the newest set, the order a card lookup
 * uses, so the same name resolves to the same printing either way.
 */
async function resolveByName(client: TcgdexClient, name: string): Promise<Card | undefined> {
  const cards = await client.searchByName(name).catch(() => []);
  const ranked = rankPrintings(cards, name);
  const [best] = [...ranked].sort((a, b) => {
    const score = scoreCandidate(name, b.name) - scoreCandidate(name, a.name);
    if (score !== 0) return score;
    const art = (b.image ? 1 : 0) - (a.image ? 1 : 0);
    if (art !== 0) return art;
    return setRecency(b.id) - setRecency(a.id);
  });
  if (!best) return undefined;
  return client.getCard(best.id).catch(() => undefined);
}

/** Basic Energy earns no prize and never rotates, so the deck check skips it. */
export function isBasicEnergy(card: Card): boolean {
  if (card.category !== "Energy") return false;
  return /^basic\s/i.test(card.name) || /^basic \{/i.test(card.name) || /^(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy|dragon|colorless) energy$/i.test(card.name);
}
