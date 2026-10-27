import type { Card, CardSummary } from "./api/types.js";
import { TcgdexError, type TcgdexClient } from "./api/tcgdex.js";
import { renderCard, type EmbedView } from "./render.js";
import { normaliseName, rankPrintings, scoreCandidate } from "./resolve.js";
import { isPocketCard, isPocketHint, resolveSetHint, setRecency } from "./set-index.js";

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
  // "pocket" is a group, not a set, so it filters rather than pins one id.
  const pocketOnly = setHint ? isPocketHint(setHint) : false;
  const hint = setHint && !pocketOnly ? (resolveSetHint(setHint) ?? setHint) : undefined;
  const summaries = await client.searchByName(query);
  const matched = rankPrintings(summaries, query, hint);
  const ranked = pocketOnly ? matched.filter((card) => isPocketCard(card.id)) : matched;
  if (ranked.length === 0) return undefined;

  const ordered = orderForDisplay(ranked, query);
  const [primary] = ordered;
  if (!primary) return undefined;

  const card = await client.getCard(primary.id);
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

  const ids = lookup.alternates.map((card) => `\`${card.id}\``).join(", ");
  const value = `${ids}
Narrow it with \`[[${lookup.card.name}|setId]]\`.`;
  return [{ ...lookup.view, fields: [...lookup.view.fields, { name: "Other printings", value }] }];
}

export function isMissing(error: unknown): boolean {
  return error instanceof TcgdexError && error.status === 404;
}
