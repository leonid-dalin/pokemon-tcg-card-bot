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
  // A single-character query matches almost every name as a substring, so it
  // only counts when the whole name equals it.
  if (q.length < 2) return 0;
  if (c.startsWith(q)) return 80 - extra;
  if (c.includes(q)) return 50 - extra;
  const tokens = q.split(" ").filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => c.includes(token))) return 30 - extra;
  return 0;
}


/** Prefixes the data uses ahead of a card name without changing which Pokémon it is. */
const NAME_PREFIXES = new Set(["mega", "team", "radiant", "shining", "dark", "light"]);

/** Possessive tokens such as "Cynthia's" and "N's" are owner prefixes. */
const POSSESSIVE = /^[\p{L}\p{N}.\-]+'s$/u;

/** Mechanics that may trail a name, so "charizard ex" and "Charizard GX" differ. */
const NAME_SUFFIXES = new Set(["ex", "gx", "v", "vmax", "vstar", "v-union", "break", "lv.x", "lv. x", "prime"]);

/** Splits a hyphen-attached mechanic onto its own token: "Moltres-EX" to "moltres ex". */
function nameTokens(name: string): string[] {
  return normaliseName(name)
    .replace(/\s+/g, " ")
    .split(" ")
    .flatMap((token) => {
      const attached = /^(.+)-((?:ex|gx|v|vmax|vstar|v-union|break|prime))$/.exec(token);
      return attached ? [attached[1]!, attached[2]!] : [token];
    })
    .filter(Boolean);
}

/**
 * True when the candidate is a printing of what the query asked for: the query's
 * words appear whole, in order and contiguous, with only an owner or mechanic
 * prefix before them and at most one mechanic suffix after. Words are never
 * removed or swapped, so "mega charizard x ex" cannot match Mega Charizard Y ex,
 * and "mew" cannot match Mewtwo.
 */
export function isPrintingOf(query: string, candidate: string): boolean {
  const wanted = nameTokens(query);
  const words = nameTokens(candidate);
  if (wanted.length === 0 || words.length < wanted.length) return false;

  let start = 0;
  while (start < words.length && start < words.length - wanted.length) {
    const token = words[start]!;
    if (!POSSESSIVE.test(token) && !NAME_PREFIXES.has(token)) break;
    start += 1;
  }
  const core = words.slice(start, start + wanted.length);
  if (core.length !== wanted.length || core.some((token, index) => token !== wanted[index])) return false;

  // A Mega letter follows the name only when the query did not name one itself.
  const rest = words.slice(start + wanted.length);
  if (rest[0] && /^[xy]$/.test(rest[0]) && words.slice(0, start).includes("mega") && !/^[xy]$/.test(wanted.at(-1)!)) {
    rest.shift();
  }
  if (rest.length === 0) return true;
  return rest.length === 1 && NAME_SUFFIXES.has(rest[0]!);
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
