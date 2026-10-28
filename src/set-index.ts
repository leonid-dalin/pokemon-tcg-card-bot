import { SET_INDEX, type SetIndexEntry } from "./data/set-index.js";
import { normaliseName, seriesRank, setIdOf } from "./resolve.js";

const byId = new Map<string, SetIndexEntry>();
const byCode = new Map<string, string>();
const byName = new Map<string, string>();

for (const entry of SET_INDEX) {
  byId.set(normaliseName(entry.id), entry);
  if (entry.code) byCode.set(entry.code.toUpperCase(), entry.id);
  byName.set(normaliseName(entry.name), entry.id);
}

// Ascending release dates give newer sets higher ranks.
const orderedByDate = [...SET_INDEX]
  .filter((entry) => entry.releaseDate)
  .sort((a, b) => (a.releaseDate ?? "").localeCompare(b.releaseDate ?? "") || a.id.localeCompare(b.id));
const recency = new Map(orderedByDate.map((entry, index) => [entry.id, index]));

/**
 * Returns a release-date rank for a card's set.
 * Unranked sets use a lower series-based fallback score.
 */
export function setRecency(cardId: string): number {
  const setId = normaliseName(setIdOf(cardId));
  const ranked = recency.get(setId);
  if (ranked !== undefined) return ranked;
  return seriesRank(cardId) - 1000;
}

/**
 * Resolves a printed code, set ID, or full/partial set name against the index.
 * Returns undefined when the hint has no match.
 */
export function resolveSetHint(hint: string): string | undefined {
  const trimmed = hint.trim();
  if (!trimmed) return undefined;

  const asCode = byCode.get(trimmed.toUpperCase());
  if (asCode) return asCode;

  const normalised = normaliseName(trimmed);
  const asId = byId.get(normalised);
  if (asId) return asId.id;

  const asName = byName.get(normalised);
  if (asName) return asName;

  // Prefer the shortest indexed name containing the partial hint.
  const partial = SET_INDEX.filter((entry) => normaliseName(entry.name).includes(normalised)).sort(
    (a, b) => (a.name.length ?? 0) - (b.name.length ?? 0),
  );
  return partial[0]?.id;
}

const POCKET_HINT = /^(ptcgp|tcgp|pocket|pocket tcg)$/i;

/** Recognises the supported aliases for the Pocket catalogue. */
export function isPocketHint(hint: string): boolean {
  return POCKET_HINT.test(hint.trim());
}

