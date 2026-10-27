import type { Card, CardSummary } from "./api/types.js";
import { TcgdexError, type TcgdexClient } from "./api/tcgdex.js";
import { priceField, renderCard, type EmbedView } from "./render.js";
import { normaliseName, rankPrintings, scoreCandidate, setIdOf } from "./resolve.js";
import { getPocketCard, searchPocketByName } from "./api/pocket.js";
import { isPocketHint, resolveSetHint, setRecency } from "./set-index.js";

export interface CardLookup {
  card: Card;
  view: EmbedView;
  alternates: CardSummary[];
}

export interface LookupOptions {
  attribution?: string;
  cardUrl?: (card: Card) => string | undefined;
  /** How many other printings to list when a name matches several. */
  alternateLimit?: number;
}

/**
 * Order candidates for display. Name exactness comes first, or "Charizard"
 * loses to "Mega Charizard X ex" purely because Mega Evolution is newer. Then
 * artwork, since TCGdex has no scan for a few promos, then the newest series,
 * then the source order.
 */
function orderForDisplay(ranked: CardSummary[], query: string): CardSummary[] {
  return [...ranked].sort((a, b) => {
    const score = scoreCandidate(query, b.name) - scoreCandidate(query, a.name);
    if (score !== 0) return score;
    const art = (b.image ? 1 : 0) - (a.image ? 1 : 0);
    if (art !== 0) return art;
    return setRecency(b.id) - setRecency(a.id);
  });
}

/**
 * English pricing first, then any locale that has pricing. TCGdex has no ja
 * route, so the chain skips straight from en to the rest.
 */
const PRICE_LOCALES = ["en", "ja", "fr", "de", "es", "it", "pt"] as const;

async function withEnglishPricing(client: TcgdexClient, card: Card): Promise<Card> {
  if (priceField(card)) return card;
  for (const lang of PRICE_LOCALES.slice(1)) {
    try {
      const alternate = await client.getCard(card.id, lang);
      if (priceField(alternate)) return alternate;
    } catch {
      // no such printing in that language
    }
  }
  return card;
}

/** A full card id, which pins one exact printing rather than a set. */
export const CARD_ID = /^[a-z0-9.]{1,12}-\d{1,4}$/i;

/** Attribution for Pocket cards, which never come from TCGdex. */
export const POCKET_ATTRIBUTION = "Pocket card data from pokemon-tcg-pocket-cards";

/**
 * Pocket lookups read the bundled PocketDecks package, because TCGdex has no
 * Pocket set newer than Paldean Wonders and cards like Crustle ex are simply
 * absent there.
 */
function lookupPocket(query: string, setHint: string | undefined, options: LookupOptions): CardLookup | undefined {
  const all = searchPocketByName(query);
  if (all.length === 0) return undefined;

  const hint = setHint && !isPocketHint(setHint) ? setHint.trim().toLowerCase() : undefined;
  const filtered = hint
    ? all.filter((summary) => {
        const card = getPocketCard(summary.id);
        const setId = (card?.set?.id ?? "").toLowerCase();
        const setName = (card?.set?.name ?? "").toLowerCase();
        return setId === hint || setName.includes(hint);
      })
    : all;
  const pool = filtered.length > 0 ? filtered : all;

  const [primary] = pool;
  if (!primary) return undefined;
  const card = getPocketCard(primary.id);
  if (!card) return undefined;

  return {
    card,
    view: renderCard(card, {
      attribution: POCKET_ATTRIBUTION,
      ...(options.cardUrl ? { cardUrl: options.cardUrl } : {}),
    }),
    alternates: pool.filter((entry) => entry.id !== primary.id).slice(0, options.alternateLimit ?? 10),
  };
}

/**
 * Pin one printing by its card id, which is what the printing buttons send back.
 */
export async function lookupById(
  client: TcgdexClient,
  id: string,
  options: LookupOptions = {},
): Promise<CardLookup | undefined> {
  const pinned = (await client.getCard(id).catch(() => undefined)) ?? getPocketCard(id);
  if (!pinned) return undefined;
  const sameName = (await client.searchByName(pinned.name).catch(() => []))
    .filter((entry) => entry.id !== pinned.id && normaliseName(entry.name) === normaliseName(pinned.name))
    .slice(0, options.alternateLimit ?? 10);
  return {
    card: pinned,
    view: renderCard(pinned, {
      ...(options.attribution ? { attribution: options.attribution } : {}),
      ...(options.cardUrl ? { cardUrl: options.cardUrl } : {}),
    }),
    alternates: sameName,
  };
}

/**
 * Resolve a name to a printing and render it. Returns undefined when nothing
 * matches, so callers can stay silent instead of posting an error for a typo.
 */
export async function lookupCard(
  client: TcgdexClient,
  query: string,
  setHint?: string,
  options: LookupOptions = {},
): Promise<CardLookup | undefined> {
  // A hint can be a set id (sv07), the printed code players use (SCR) or the set
  // name (Stellar Crown). All three resolve offline against the set index.
  // The embed prints card ids in the Other printings field, so a hint that looks
  // like one pins that exact printing. Without this the id falls through to set
  // matching, matches nothing, and returns a different printing.
  if (setHint && CARD_ID.test(setHint.trim())) {
    return lookupById(client, setHint.trim(), options);
  }

  // "pocket" is a group, not a set, so it filters rather than pins one id.
  const pocketOnly = setHint ? isPocketHint(setHint) : false;
  if (pocketOnly) return lookupPocket(query, setHint, options);
  const resolved = setHint && !pocketOnly ? resolveSetHint(setHint) : undefined;
  const summaries = await client.searchByName(query);
  const matched = rankPrintings(summaries, query, resolved ?? (pocketOnly ? undefined : setHint));

  // A hint that resolved to a real set pins that set exactly. Prefix matching
  // would let "A1" also match "A1a", and the newer set then wins the ranking.
  const pinned = resolved
    ? matched.filter((card) => normaliseName(setIdOf(card.id)) === normaliseName(resolved))
    : matched;
  const ranked = pinned;
  // TCGdex stops before the newest Pocket sets, so an empty result falls back
  // to the bundled Pocket data before giving up.
  if (ranked.length === 0) return lookupPocket(query, setHint, options);

  const ordered = orderForDisplay(ranked, query);
  const [primary] = ordered;
  if (!primary) return undefined;

  const card = await withEnglishPricing(client, await client.getCard(primary.id));
  // "Printings of X" only makes sense for the same card name, so a query for
  // "Dragapult ex" never lists the plain Dragapult as another printing.
  const target = normaliseName(card.name);
  const alternates = ordered
    .filter((entry) => entry.id !== primary.id && normaliseName(entry.name) === target)
    .slice(0, options.alternateLimit ?? 10);
  return {
    card,
    view: renderCard(card, {
      ...(options.attribution ? { attribution: options.attribution } : {}),
      ...(options.cardUrl ? { cardUrl: options.cardUrl } : {}),
    }),
    alternates,
  };
}

/**
 * One embed per mention. Other printings ride along as a field rather than a
 * second embed, because two embeds read as two answers to one question.
 */
export function lookupEmbeds(lookup: CardLookup): EmbedView[] {
  if (lookup.alternates.length === 0) return [lookup.view];

  const seen = new Set<string>();
  const ids = lookup.alternates
    .filter((card) => (seen.has(card.id) ? false : (seen.add(card.id), true)))
    .map((card) => `\`${card.id}\``)
    .join(", ");
  const value = `${ids}
Narrow it with \`[[${lookup.card.name}|setId]]\`.`;
  return [{ ...lookup.view, fields: [...lookup.view.fields, { name: "Other printings", value }] }];
}

export function isMissing(error: unknown): boolean {
  return error instanceof TcgdexError && error.status === 404;
}

/**
 * Closest names when a lookup misses. Dropping the last word is what turns
 * "Crustle ex" into "Crustle", which is the common case: people add a suffix
 * that no printing carries.
 */
export async function suggestNames(
  client: TcgdexClient,
  query: string,
  limit = 3,
): Promise<CardSummary[]> {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [];
  const shortened = words.slice(0, -1).join(" ");
  try {
    const cards = await client.searchByName(shortened);
    return orderForDisplay(rankPrintings(cards, shortened), shortened).slice(0, limit);
  } catch {
    return [];
  }
}
