import type { CardSummary } from "./api/types.js";

export interface RankedPrinting {
  card: CardSummary;
  score: number;
}

export interface Resolution {
  primary: CardSummary;
  alternates: CardSummary[];
}

/** Fold case, accents and spacing so "Pokémon" and "pokemon" match. */
export function normaliseName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Card ids are `<setId>-<localId>`, so the set id is everything before the last dash. */
export function setIdOf(cardId: string): string {
  const at = cardId.lastIndexOf("-");
  return at > 0 ? cardId.slice(0, at) : "";
}

export function setIdMatches(cardId: string, hint: string): boolean {
  const setId = normaliseName(setIdOf(cardId));
  const wanted = normaliseName(hint);
  if (!setId || !wanted) return false;
  return setId === wanted || setId.startsWith(wanted) || setId.endsWith(wanted);
}

/**
 * Score a printing against the query. Exact beats prefix beats substring, and
 * the length penalty prefers the shortest name that still matches, so
 * "Dragapult ex" does not lose to "Dragapult ex XY Promos".
 */
export function scoreCandidate(query: string, candidate: string): number {
  const q = normaliseName(query);
  const c = normaliseName(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  const extra = Math.min(20, Math.max(0, c.length - q.length));
  if (c.startsWith(q)) return 80 - extra;
  if (c.includes(q)) return 50 - extra;
  const tokens = q.split(" ").filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => c.includes(token))) return 30 - extra;
  return 0;
}

/**
 * Rank printings for a query. Upstream order is preserved inside equal scores
 * because it is newest first, which is the printing people usually mean.
 */
export function rankPrintings(
  summaries: CardSummary[],
  query: string,
  setHint?: string,
): CardSummary[] {
  const pool = setHint ? summaries.filter((card) => setIdMatches(card.id, setHint)) : summaries;
  const ranked: RankedPrinting[] = pool
    .map((card) => ({ card, score: scoreCandidate(query, card.name) }))
    .filter((entry) => entry.score > 0);
  ranked.sort((a, b) => b.score - a.score);
  return ranked.map((entry) => entry.card);
}


/**
 * Set ids begin with their series, and the search API returns printings in no
 * useful order, so a plain name like "charizard" otherwise resolves to a 2009
 * card. This ranks series oldest to newest; the longest prefix wins so "swshp"
 * is Sword and Shield rather than something else that starts with "s".
 */
const SERIES_ORDER = [
  "base",
  "gym",
  "neo",
  "lc",
  "ex",
  "dp",
  "pl",
  "hgss",
  "bw",
  "xy",
  "sm",
  "swsh",
  "sv",
  "me",
  "tcgp",
  "30th",
] as const;

export function seriesRank(cardId: string): number {
  const setId = normaliseName(setIdOf(cardId));
  let rank = -1;
  for (const [index, series] of SERIES_ORDER.entries()) {
    if (setId.startsWith(series)) rank = Math.max(rank, index);
  }
  return rank;
}

export function resolvePrinting(
  summaries: CardSummary[],
  query: string,
  setHint?: string,
): Resolution | undefined {
  const ranked = rankPrintings(summaries, query, setHint);
  const [primary, ...rest] = ranked;
  if (!primary) return undefined;
  return { primary, alternates: rest };
}
