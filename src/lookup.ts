import type { Card, CardSummary } from "./api/types.js";
import { TcgdexError, type TcgdexClient } from "./api/tcgdex.js";
import { cardImage, priceField, renderCard, renderCardImage, type EmbedView } from "./render.js";
import { printedNumber } from "./printed.js";
import { normaliseName, rankPrintings, scoreCandidate, setIdOf } from "./resolve.js";
import { indexedText } from "./text-search.js";
import { getPocketCard, searchPocketByName } from "./api/pocket.js";
import { isPocketHint, resolveSetHint, setRecency } from "./set-index.js";

export interface CardLookup {
  card: Card;
  /** Every other printing of the name, which the Other printings field lists. */
  alternates: CardSummary[];
  /** The printings whose wording matches the card, which get buttons. */
  matchingPrintings?: CardSummary[];
  /** Footer credit naming the source that served the card. */
  attribution?: string;
  energyEmoji?: Record<string, string>;
  /** The mention asked for the scan alone. */
  imageOnly?: true;
}

export interface LookupOptions {
  attribution?: string;
  energyEmoji?: Record<string, string>;
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
 * English pricing first, then any locale that has pricing. TCGdex's ja catalogue
 * uses its own ids, so an English id is never found there and ja is left out.
 */
const PRICE_LOCALES = ["en", "fr", "de", "es", "it", "pt"] as const;

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

/**
 * The one rule for "other printings": the same card name, never the card
 * itself. Every lookup path builds its result here, so TCGdex and Pocket
 * answers cannot drift apart.
 */
function toLookup(
  card: Card,
  candidates: CardSummary[],
  attribution: string | undefined,
  energyEmoji?: Record<string, string>,
  limit = 10,
): CardLookup {
  const name = normaliseName(card.name);
  const alternates = candidates
    .filter((entry) => entry.id !== card.id && normaliseName(entry.name) === name)
    .slice(0, limit);
  return { card, alternates, matchingPrintings: printingsForButtons(card, alternates), ...(attribution ? { attribution } : {}), ...(energyEmoji ? { energyEmoji } : {}) };
}

/**
 * The printings a reply may offer as buttons: those that word the card the
 * same way. Pokémon reprints often change abilities and attacks between sets,
 * so a button to a different wording is a different card wearing the name;
 * those stay in the Other printings field instead. A card the index does not
 * know, and Trainer or Energy wording, never changes, so every printing keeps
 * its button there.
 */
export function printingsForButtons(card: Card, candidates: CardSummary[]): CardSummary[] {
  const alternates = candidates.filter((entry) => entry.id !== card.id);
  const primary = indexedText(card.id);
  if (primary === undefined || card.category !== "Pokemon") return alternates;
  return alternates.filter((entry) => indexedText(entry.id) === primary);
}

/** A full card id, which pins one exact printing rather than a name. Set ids
 * may end in subset letters (swsh12.5gg) or carry none (swshp), and the local
 * number may carry its own letters (GG65, SV004, SWSH020). A name with a
 * hyphen, like Porygon-Z, carries no digit and must not match. */
export const CARD_ID = /^(?=.{3,24}$)[a-z0-9.]+[a-z]{0,3}-[a-z0-9]{1,8}$/i;
export const isCardId = (value: string): boolean => CARD_ID.test(value) && /\d/.test(value);

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
  return toLookup(card, pool, POCKET_ATTRIBUTION, options.energyEmoji, options.alternateLimit);
}

/**
 * Pin one printing by its card id, which is what the printing buttons send back.
 */
export async function lookupById(
  client: TcgdexClient,
  id: string,
  options: LookupOptions = {},
): Promise<CardLookup | undefined> {
  // Only a 404 means the id is unknown to TCGdex. Any other failure is an
  // outage, and answering "no card matched" would blame the asker for it.
  let tcgdexCard: Card | undefined;
  let outage: unknown;
  try {
    tcgdexCard = await client.getCard(id);
  } catch (error) {
    if (!isMissing(error)) outage = error;
  }
  const pocketCard = tcgdexCard ? undefined : getPocketCard(id);
  const pinned = tcgdexCard ?? pocketCard;
  if (!pinned) {
    if (outage !== undefined) throw outage;
    return undefined;
  }

  // A Pocket printing lists other Pocket printings, never the physical cards
  // TCGdex returns for the same name.
  const candidates = pocketCard
    ? searchPocketByName(pinned.name)
    : await client.searchByName(pinned.name).catch(() => []);
  return toLookup(pinned, candidates, pocketCard ? POCKET_ATTRIBUTION : options.attribution, options.energyEmoji, options.alternateLimit);
}

/**
 * TCGdex matches name searches literally, so `PokeStop` finds nothing while
 * `PokéStop` finds the card. These are the accented spellings to try when the
 * literal search came back empty. Each word is anchored, so `Slowpoke` is left
 * alone; every accented card name the index holds is covered here.
 */
const ACCENTS: { from: RegExp; to: string }[] = [
  { from: /\bpokemon\b/gi, to: "Pokémon" },
  { from: /\bpoke(?=[A-Z0-9]|\s|$)/gi, to: "Poké" },
  { from: /\bflabebe\b/gi, to: "Flabébé" },
  { from: /\bcafe\b/gi, to: "Café" },
];

const HAS_ACCENT = /[éèêëáàâäíìîïóòôöúùûüñç]/i;

export function accentVariants(query: string): string[] {
  if (HAS_ACCENT.test(query)) return [];
  const variants = new Set<string>();
  for (const { from, to } of ACCENTS) {
    const variant = query.replace(from, to);
    if (variant !== query) variants.add(variant);
  }
  return [...variants];
}

/**
 * Search the literal spelling first, and try the accented ones only when it
 * finds nothing. A name that searches fine, `Slowpoke` being the common case,
 * therefore never pays for a second request.
 */
async function searchWithAccents(client: TcgdexClient, query: string): Promise<CardSummary[]> {
  const literal = await client.searchByName(query);
  if (literal.length > 0) return literal;
  for (const variant of accentVariants(query)) {
    const hits = await client.searchByName(variant).catch(() => []);
    if (hits.length > 0) return hits;
  }
  return literal;
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
  if (setHint && isCardId(setHint.trim())) {
    return lookupById(client, setHint.trim(), options);
  }

  // "pocket" is a group, not a set, so it filters rather than pins one id.
  const pocketOnly = setHint ? isPocketHint(setHint) : false;
  if (pocketOnly) return lookupPocket(query, setHint, options);
  const resolved = setHint ? resolveSetHint(setHint) : undefined;

  // A hint that names no set is a mistake, and falling back to the bare name
  // would answer with a printing the asker did not ask for.
  if (setHint && !resolved) return undefined;
  const summaries = await searchWithAccents(client, query);
  const matched = rankPrintings(summaries, query, resolved);

  // A hint that resolved to a real set pins that set exactly. Prefix matching
  // would let "A1" also match "A1a", and the newer set then wins the ranking.
  const ranked = resolved
    ? matched.filter((card) => normaliseName(setIdOf(card.id)) === normaliseName(resolved))
    : matched;
  // TCGdex stops before the newest Pocket sets, so an empty result falls back
  // to the bundled Pocket data before giving up.
  if (ranked.length === 0) return lookupPocket(query, setHint, options);

  const ordered = orderForDisplay(ranked, query);
  const [primary] = ordered;
  if (!primary) return undefined;

  const card = await withEnglishPricing(client, await client.getCard(primary.id));
  return toLookup(card, ordered, options.attribution, options.energyEmoji, options.alternateLimit);
}

/**
 * Whether this answer is the scan alone. A card with no scan has nothing to
 * show but its front, so it keeps the normal answer.
 */
export function isImageOnly(lookup: CardLookup): boolean {
  return lookup.imageOnly === true && cardImage(lookup.card) !== undefined;
}

/**
 * One embed per mention. Other printings ride along as a field rather than a
 * second embed, because two embeds read as two answers to one question.
 */
export function lookupEmbeds(lookup: CardLookup): EmbedView[] {
  const options = {
    ...(lookup.attribution ? { attribution: lookup.attribution } : {}),
    ...(lookup.energyEmoji ? { energyEmoji: lookup.energyEmoji } : {}),
  };
  if (isImageOnly(lookup)) {
    return [renderCardImage(lookup.card, options)];
  }
  const view = renderCard(lookup.card, options);
  if (lookup.alternates.length === 0) return [view];

  const seen = new Set<string>();
  const ids = lookup.alternates
    .filter((card) => (seen.has(card.id) ? false : (seen.add(card.id), true)))
    .map((card) => `\`${printedNumber(card.id)}\``)
    .join(", ");
  return [{ ...view, fields: [...view.fields, { name: "Other printings", value: ids }] }];
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
