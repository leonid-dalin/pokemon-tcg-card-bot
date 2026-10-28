import type { CardSummary } from "./api/types.js";

interface RankedPrinting {
  card: CardSummary;
  score: number;
}

/** Normalises case, accents, apostrophes and whitespace for name comparison. */
export function normaliseName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extracts the set prefix before the final hyphen, or an empty string if absent. */
export function setIdOf(cardId: string): string {
  const at = cardId.lastIndexOf("-");
  return at > 0 ? cardId.slice(0, at) : "";
}

/** Matches an exact set ID or a prefix/suffix hint after normalisation. */
export function setIdMatches(cardId: string, hint: string): boolean {
  const setId = normaliseName(setIdOf(cardId));
  const wanted = normaliseName(hint);
  if (!setId || !wanted) return false;
  return setId === wanted || setId.startsWith(wanted) || setId.endsWith(wanted);
}

/**
 * Scores normalised names by exact, prefix, substring, then multiword matching.
 * A length penalty favours shorter partial matches. Zero means no match.
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
 * Filters by the optional partial set hint and ranks positive name matches.
 * Equal scores retain input order; this function does not sort by release date.
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
 * Fallback series order for sets without an indexed release date.
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

/** Returns the highest matching series index, or -1 for an unknown series. */
export function seriesRank(cardId: string): number {
  const setId = normaliseName(setIdOf(cardId));
  let rank = -1;
  for (const [index, series] of SERIES_ORDER.entries()) {
    if (setId.startsWith(series)) rank = Math.max(rank, index);
  }
  return rank;
}
