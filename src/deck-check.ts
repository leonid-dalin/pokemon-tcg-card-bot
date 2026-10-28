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

/** A set numbers basic Energy as `Psychic Energy`, while a decklist writes `Basic {P} Energy` or `Basic Psychic Energy`. */
const POKEMON_TYPES = ["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Fairy", "Dragon", "Colorless"];
const TYPE_LETTERS: Record<string, string> = { G: "Grass", R: "Fire", W: "Water", L: "Lightning", P: "Psychic", F: "Fighting", D: "Darkness", M: "Metal", Y: "Fairy", N: "Dragon", C: "Colorless" };

/** Fold an energy name to the type it holds, so the three spellings compare equal. */
function energyName(value: string): string {
  const folded = normaliseName(value);
  const bracketed = /basic\s*\{([a-z])\}/.exec(folded);
  if (bracketed) return normaliseName(TYPE_LETTERS[bracketed[1]!.toUpperCase()] ?? folded);
  // `Basic Psychic Energy` and the set's own `Psychic Energy` name the same card.
  const named = /^(?:basic\s+)?([a-z]+)(?:\s+energy)?$/.exec(folded);
  if (named && POKEMON_TYPES.some((type) => normaliseName(type) === named[1])) return named[1]!;
  return folded;
}

/** True when a card answers to the line's name, including the energy spellings. */
function sameName(cardName: string, lineName: string): boolean {
  if (normaliseName(cardName) === normaliseName(lineName)) return true;
  return energyName(cardName) === energyName(lineName) && energyName(cardName) !== normaliseName(cardName);
}

async function resolveLine(client: TcgdexClient, line: DeckLine): Promise<Card | undefined> {
  if (line.setCode && line.number) {
    // A PTCGL code is the printed code, and the set index maps it to the card
    // id prefix. The set id is not always that prefix: SVI prints as sv01.
    const prefix = entryByCode.get(normaliseName(line.setCode))?.id ?? line.setCode;
    const bare = line.number.replace(/^0+(?=\d)/, "");
    for (const candidate of [`${prefix}-${bare}`, `${prefix}-${bare.padStart(3, "0")}`]) {
      const card = await client.getCard(candidate).catch(() => undefined);
      // A printing a set reuses for another card would otherwise be accepted on
      // its number alone, so the name has to agree.
      if (card && sameName(card.name, line.name)) return card;
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
  const card = await client.getCard(best.id).catch(() => undefined);
  // A prefix or loose match that names another card cannot supply legality or
  // price for the line, so it counts as unresolved.
  return card && sameName(card.name, name) ? card : undefined;
}

/** Basic Energy earns no prize and never rotates, so the deck check skips it. */
export function isBasicEnergy(card: Card): boolean {
  if (card.category !== "Energy") return false;
  return /^basic\s/i.test(card.name) || /^basic \{/i.test(card.name) || /^(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy|dragon|colorless) energy$/i.test(card.name);
}
