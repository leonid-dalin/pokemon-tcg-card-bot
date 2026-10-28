import type { Card } from "./api/types.js";
import type { TcgdexClient } from "./api/tcgdex.js";
import type { DeckLine, ParsedDeck } from "./decklist.js";
import { SET_INDEX } from "./data/set-index.js";
import { normaliseName, rankPrintings, scoreCandidate } from "./resolve.js";
import { setRecency } from "./set-index.js";

export interface ResolvedLine {
  line: DeckLine;
  /** Omitted when the line does not resolve to a card. */
  card?: Card;
}

// Limit upstream lookups while resolving each deck.
const RESOLVE_CONCURRENCY = 4;

const entryByCode = new Map(
  SET_INDEX.filter((entry) => entry.code).map((entry) => [normaliseName(entry.code as string), entry]),
);

/** Resolves decklist lines with at most four concurrent line lookups. */
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

// Decklists and set records use different names for basic Energy.
const POKEMON_TYPES = ["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Fairy", "Dragon", "Colorless"];
const TYPE_LETTERS: Record<string, string> = { G: "Grass", R: "Fire", W: "Water", L: "Lightning", P: "Psychic", F: "Fighting", D: "Darkness", M: "Metal", Y: "Fairy", N: "Dragon", C: "Colorless" };

function energyName(value: string): string {
  const folded = normaliseName(value);
  const bracketed = /basic\s*\{([a-z])\}/.exec(folded);
  if (bracketed) return normaliseName(TYPE_LETTERS[bracketed[1]!.toUpperCase()] ?? folded);
  // Ignore the optional Basic prefix and Energy suffix when comparing types.
  const named = /^(?:basic\s+)?([a-z]+)(?:\s+energy)?$/.exec(folded);
  if (named && POKEMON_TYPES.some((type) => normaliseName(type) === named[1])) return named[1]!;
  return folded;
}

function sameName(cardName: string, lineName: string): boolean {
  if (normaliseName(cardName) === normaliseName(lineName)) return true;
  return energyName(cardName) === energyName(lineName) && energyName(cardName) !== normaliseName(cardName);
}

async function resolveLine(client: TcgdexClient, line: DeckLine): Promise<Card | undefined> {
  if (line.setCode && line.number) {
    // Printed set codes can map to a different TCGdex card-id prefix.
    const prefix = entryByCode.get(normaliseName(line.setCode))?.id ?? line.setCode;
    const bare = line.number.replace(/^0+(?=\d)/, "");
    for (const candidate of [`${prefix}-${bare}`, `${prefix}-${bare.padStart(3, "0")}`]) {
      const card = await client.getCard(candidate).catch(() => undefined);
      // Confirm that the supplied set and number resolve to the requested name.
      if (card && sameName(card.name, line.name)) return card;
    }
  }
  return resolveByName(client, line.name);
}

// Fall back to name matching when the printed set code or number is unavailable.
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
  // Reject approximate search results whose card name does not match the line.
  return card && sameName(card.name, name) ? card : undefined;
}

/** Recognises Basic Energy by category and supported name forms. */
export function isBasicEnergy(card: Card): boolean {
  if (card.category !== "Energy") return false;
  return /^basic\s/i.test(card.name) || /^basic \{/i.test(card.name) || /^(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy|dragon|colorless) energy$/i.test(card.name);
}
