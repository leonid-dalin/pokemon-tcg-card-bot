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

// Sorted oldest to newest, so a higher index means a newer set.
const orderedByDate = [...SET_INDEX]
  .filter((entry) => entry.releaseDate)
  .sort((a, b) => (a.releaseDate ?? "").localeCompare(b.releaseDate ?? "") || a.id.localeCompare(b.id));
const recency = new Map(orderedByDate.map((entry, index) => [entry.id, index]));

/**
 * How new a set is, from real release dates rather than a hand-written series
 * list. Falls back to the series table for a set the index does not know, which
 * is what a brand new set looks like before `npm run index:sets` is rerun.
 */
export function setRecency(cardId: string): number {
  const setId = normaliseName(setIdOf(cardId));
  const ranked = recency.get(setId);
  if (ranked !== undefined) return ranked;
  return seriesRank(cardId) - 1000;
}

/**
 * Turn a hint into a set id. Accepts the id itself (`sv07`), the printed code
 * players actually use (`SCR`), or the set name (`Stellar Crown`), with case and
 * accents folded.
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

  // Partial set name, longest match first so "Stellar" does not pick a promo.
  const partial = SET_INDEX.filter((entry) => normaliseName(entry.name).includes(normalised)).sort(
    (a, b) => (a.name.length ?? 0) - (b.name.length ?? 0),
  );
  return partial[0]?.id;
}

const POCKET_HINT = /^(ptcgp|tcgp|pocket|pocket tcg)$/i;

/** True when the hint means "any Pocket set" rather than one set. */
export function isPocketHint(hint: string): boolean {
  return POCKET_HINT.test(hint.trim());
}

