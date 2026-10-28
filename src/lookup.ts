import type { Card, CardSummary } from "./api/types.js";
import { TcgdexError, type TcgdexClient } from "./api/tcgdex.js";
import { cardImage, priceField, renderCard, renderCardImage, type EmbedView } from "./render.js";
import { printedNumber } from "./printed.js";
import { normaliseName, rankPrintings, scoreCandidate, setIdOf } from "./resolve.js";
import { indexedText } from "./text-search.js";
import { getPocketCard, searchPocketByName } from "./api/pocket.js";
import { isPocketCard, isPocketSet } from "./prizes.js";
import { isPocketHint, resolveSetHint, setRecency } from "./set-index.js";
import { SET_INDEX } from "./data/set-index.js";

export interface CardLookup {
  card: Card;
  /** Other same-name printings, capped by `alternateLimit`. */
  alternates: CardSummary[];
  /** Alternates eligible for printing buttons under the index wording check. */
  matchingPrintings?: CardSummary[];
  /** Source credit for this lookup's embeds. */
  attribution?: string;
  energyEmoji?: Record<string, string>;
  /** Requests a scan-only embed when the card has an image. */
  imageOnly?: true;
}

export interface LookupOptions {
  attribution?: string;
  energyEmoji?: Record<string, string>;
  alternateLimit?: number;
  /** Per-server game preference; forcing a game with a hint or exact ID always wins. */
  gamePreference?: { allowed: import("./settings-store.js").CardGameScope; default: import("./settings-store.js").CardGameDefault };
}

// Display order: name score, image availability, set recency, then input order.
function orderForDisplay(ranked: CardSummary[], query: string): CardSummary[] {
  return [...ranked].sort((a, b) => {
    const score = scoreCandidate(query, b.name) - scoreCandidate(query, a.name);
    if (score !== 0) return score;
    const art = (b.image ? 1 : 0) - (a.image ? 1 : 0);
    if (art !== 0) return art;
    return setRecency(b.id) - setRecency(a.id);
  });
}

// Locale fallback order for card responses without displayable prices.
const PRICE_LOCALES = ["en", "fr", "de", "es", "it", "pt"] as const;

/** Returns the original card or the first locale response with displayable prices. */
async function withEnglishPricing(client: TcgdexClient, card: Card): Promise<Card> {
  if (priceField(card)) return card;
  for (const lang of PRICE_LOCALES.slice(1)) {
    try {
      const alternate = await client.getCard(card.id, lang);
      if (priceField(alternate)) return alternate;
    } catch {
      // Continue to the next locale after a lookup failure.
    }
  }
  return card;
}

// Keep same-name alternates in candidate order, excluding the selected ID.
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
 * Keeps alternates with the same normalised indexed wording.
 * If the primary card is absent from the index, keeps all supplied alternates.
 */
export function printingsForButtons(card: Card, candidates: CardSummary[]): CardSummary[] {
  const alternates = candidates.filter((entry) => entry.id !== card.id);
  const primary = indexedText(card.id);
  if (primary === undefined) return alternates;
  return alternates.filter((entry) => indexedText(entry.id) === primary);
}

// Set IDs may contain hyphens; local IDs include letters and punctuation.
const SET_IDS = new Set(SET_INDEX.map((entry) => normaliseName(entry.id)));
const LOCAL_ID = /^[a-z0-9.!%]{1,8}$/i;
export const CARD_ID = /^[a-z0-9.]+(?:-[a-z0-9.]+)*-[a-z0-9.!%]{1,8}$/i;
/** Recognises IDs from indexed sets or exact records in the Pocket package. */
export const isCardId = (value: string): boolean => {
  const at = value.lastIndexOf("-");
  if (at <= 0 || at === value.length - 1) return false;
  if (!LOCAL_ID.test(value.slice(at + 1))) return false;
  // The package includes Pocket sets absent from the TCGdex set index.
  return SET_IDS.has(normaliseName(value.slice(0, at))) || getPocketCard(value) !== undefined;
};

/** Source credit for cards loaded from the Pocket package. */
export const POCKET_ATTRIBUTION = "Pocket card data from pokemon-tcg-pocket-cards";

// Resolve against the package; use the hint's subset when it contains a match.
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
 * Resolves an exact ID through TCGdex, then the Pocket package.
 * Returns undefined for an unknown ID; propagates unresolved upstream failures.
 */
export async function lookupById(
  client: TcgdexClient,
  id: string,
  options: LookupOptions = {},
): Promise<CardLookup | undefined> {
  // Preserve upstream failures while checking whether the package has the card.
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

  // Package cards use package alternates to keep the source catalogue consistent.
  const candidates = pocketCard
    ? searchPocketByName(pinned.name)
    : await client.searchByName(pinned.name).catch(() => []);
  return toLookup(pinned, candidates, pocketCard ? POCKET_ATTRIBUTION : options.attribution, options.energyEmoji, options.alternateLimit);
}

// Supported accent substitutions for an empty literal name search.
const ACCENTS: { from: RegExp; to: string }[] = [
  { from: /\bpokemon\b/gi, to: "Pokémon" },
  { from: /\bpoke(?=[A-Z0-9]|\s|$)/gi, to: "Poké" },
  { from: /\bflabebe\b/gi, to: "Flabébé" },
  { from: /\bcafe\b/gi, to: "Café" },
];

const HAS_ACCENT = /[éèêëáàâäíìîïóòôöúùûüñç]/i;

/** Generates supported accented spellings unless the query already has an accent. */
export function accentVariants(query: string): string[] {
  if (HAS_ACCENT.test(query)) return [];
  const variants = new Set<string>();
  for (const { from, to } of ACCENTS) {
    const variant = query.replace(from, to);
    if (variant !== query) variants.add(variant);
  }
  return [...variants];
}

/** Searches literally, then returns the first non-empty accented-variant result. */
export async function searchWithAccents(client: TcgdexClient, query: string): Promise<CardSummary[]> {
  const literal = await client.searchByName(query);
  if (literal.length > 0) return literal;
  for (const variant of accentVariants(query)) {
    const hits = await client.searchByName(variant).catch(() => []);
    if (hits.length > 0) return hits;
  }
  return literal;
}

/**
 * Resolves a name with an optional set hint or exact card ID.
 * Returns undefined when the name or hint cannot be resolved.
 */
export async function lookupCard(
  client: TcgdexClient,
  query: string,
  setHint?: string,
  options: LookupOptions = {},
): Promise<CardLookup | undefined> {
  // Exact card IDs bypass name and set matching.
  if (setHint && isCardId(setHint.trim())) {
    return lookupById(client, setHint.trim(), options);
  }

  // A Pocket alias selects the package catalogue; forcing a game always wins.
  const pocketOnly = setHint ? isPocketHint(setHint) : false;
  if (pocketOnly) return lookupPocket(query, setHint, options);
  const resolved = setHint ? resolveSetHint(setHint) : undefined;
  if (setHint && !resolved) return undefined;
  // An explicit Pocket set hint is a game choice: it overrides a physical-only
  // preference, while without a preference the TCGdex path and its package
  // fallback keep their existing behaviour.
  const hintPocketSet = resolved !== undefined && isPocketSet(resolved);
  const preference = options.gamePreference;
  if (hintPocketSet && preference && preference.allowed !== "both") return lookupPocket(query, setHint, options);
  const forcedPhysical = Boolean(setHint) && !hintPocketSet;
  if (!forcedPhysical && preference?.allowed === "pocket") return lookupPocket(query, setHint, options);

  // The preference's default game applies only to unhinted names, and only when the
  // package has the exact requested name; partial package matches must not win.
  if (preference?.allowed === "both" && preference.default === "pocket" && !setHint) {
    const pocket = lookupPocket(query, undefined, options);
    if (pocket && normaliseName(pocket.card.name) === normaliseName(query)) return pocket;
  }
  const summaries = await searchWithAccents(client, query);
  const matched = (preference?.allowed === "ptcg" ? summaries.filter((card) => !isPocketCard(card as Card)) : summaries).filter(Boolean) as CardSummary[];
  const rankedBySet = rankPrintings(matched, query, resolved);

  // Enforce the exact resolved set after rankPrintings' partial set matching.
  const ranked = resolved
    ? rankedBySet.filter((card) => normaliseName(setIdOf(card.id)) === normaliseName(resolved))
    : rankedBySet;
  // Try the package when TCGdex has no matching candidates and the server allows it.
  if (ranked.length === 0) {
    if (preference?.allowed === "ptcg" || forcedPhysical) return undefined;
    return lookupPocket(query, setHint, options);
  }

  // For a shared name, the preferred game wins before artwork or recency comparisons.
  const physicalRanked = ranked.filter((card) => !isPocketCard(card as Card));
  const ordered = orderForDisplay(
    preference?.allowed === "both" && preference.default === "ptcg" && physicalRanked.length ? physicalRanked : ranked,
    query,
  );
  const [primary] = ordered;
  if (!primary) return undefined;

  const card = await withEnglishPricing(client, await client.getCard(primary.id));
  return toLookup(card, ordered, options.attribution, options.energyEmoji, options.alternateLimit);
}

/** Enables scan-only output only when the requested card has an image. */
export function isImageOnly(lookup: CardLookup): boolean {
  return lookup.imageOnly === true && cardImage(lookup.card) !== undefined;
}

/** Builds one embed, adding alternate printing labels to a normal card reply. */
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

/** Identifies a TCGdex 404 response. */
export function isMissing(error: unknown): boolean {
  return error instanceof TcgdexError && error.status === 404;
}

/**
 * Searches for candidates after removing the query's final word.
 * Single-word queries and failed searches return an empty list.
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
