import { SET_INDEX } from "./data/set-index.js";
import { normaliseName, setIdOf } from "./resolve.js";

/** Pocket set ids: a1, a2b, b4b, the package promos pa/pb, and p-a. */
const POCKET_SET = /^(?:[ab]\d+[a-z]?|p[ab]?-[ab]?|p[ab])$/i;

/** Package promos print as P-A and P-B, not as the bare package ids. */
const PROMO_CODE = /^p([ab])$/i;

const codeBySet = new Map(
  SET_INDEX.filter((entry) => entry.code).map((entry) => [normaliseName(entry.id), entry.code as string]),
);

/**
 * How a card's printing is written by players: the set code and the number
 * without leading zeros. A set with no code falls back to the set id in upper
 * case for Pocket, and to the raw card id for anything else, because inventing
 * a code would be worse than showing the database id.
 */
export function printedNumber(cardId: string): string {
  const setId = setIdOf(cardId);
  if (!setId) return cardId;

  const number = cardId.slice(setId.length + 1);
  const bare = /^\d+$/.test(number) ? number.replace(/^0+(?=\d)/, "") : number;
  const code = codeBySet.get(normaliseName(setId));
  const promo = PROMO_CODE.exec(setId);

  // Subset codes carry a colon, "SIT:TG" for a trainer gallery. The part before
  // it is the code a player writes, and the number already says which subset.
  if (code) return `${code.split(":")[0]} ${bare}`;
  if (promo) return `P-${promo[1]!.toUpperCase()} ${bare}`;
  if (POCKET_SET.test(setId)) return `${setId.toUpperCase()} ${bare}`;
  return cardId;
}
