import type { Card, CardSummary } from "./api/types.js";
import { TcgdexError, type TcgdexClient } from "./api/tcgdex.js";
import { renderCard, renderPrintingChoices, type EmbedView } from "./render.js";
import { normaliseName, rankPrintings, setIdOf } from "./resolve.js";

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
  /** How many candidates to date-check when choosing the newest printing. */
  recencySample?: number;
}

/**
 * Order candidates newest set first. TCGdex set details carry releaseDate and
 * are small, so checking the top few candidates costs one cached request each
 * and stops a query for Pikachu landing on a 1999 promo.
 */
async function newestFirst(
  client: TcgdexClient,
  ranked: CardSummary[],
  sample: number,
): Promise<CardSummary[]> {
  const head = ranked.slice(0, sample);
  const tail = ranked.slice(sample);
  const dated = await Promise.all(
    head.map(async (card) => {
      try {
        const set = await client.getSet(setIdOf(card.id));
        return { card, date: set.releaseDate ?? "" };
      } catch {
        return { card, date: "" };
      }
    }),
  );
  dated.sort((a, b) => {
    const aArt = a.card.image ? 1 : 0;
    const bArt = b.card.image ? 1 : 0;
    if (aArt !== bArt) return bArt - aArt;
    return a.date === b.date ? 0 : a.date < b.date ? 1 : -1;
  });
  return [...dated.map((entry) => entry.card), ...tail];
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
  const summaries = await client.searchByName(query);
  const ranked = rankPrintings(summaries, query, setHint);
  if (ranked.length === 0) return undefined;

  const ordered = await newestFirst(client, ranked, options.recencySample ?? 5);
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

/** The embeds a single mention should produce: the card, then other printings if any. */
export function lookupEmbeds(lookup: CardLookup): EmbedView[] {
  const views: EmbedView[] = [lookup.view];
  if (lookup.alternates.length > 0) {
    views.push(renderPrintingChoices(lookup.card.name, lookup.alternates));
  }
  return views;
}

export function isMissing(error: unknown): boolean {
  return error instanceof TcgdexError && error.status === 404;
}
