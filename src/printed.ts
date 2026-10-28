import { SET_INDEX } from "./data/set-index.js";
import { normaliseName, setIdOf } from "./resolve.js";

// Recognise regular Pocket sets and both package and hyphenated promo prefixes.
const POCKET_SET = /^(?:[ab]\d+[a-z]?|p[ab]?-[ab]?|p[ab])$/i;

// Display package promo prefixes pa/pb as P-A/P-B.
const PROMO_CODE = /^p([ab])$/i;

const codeBySet = new Map(
  SET_INDEX.filter((entry) => entry.code).map((entry) => [normaliseName(entry.id), entry.code as string]),
);

/**
 * Formats a printing with its indexed set code and card number.
 * Pocket sets use their own codes; unknown physical sets retain the raw ID.
 */
export function printedNumber(cardId: string): string {
  const setId = setIdOf(cardId);
  if (!setId) return cardId;

  const number = cardId.slice(setId.length + 1);
  const bare = /^\d+$/.test(number) ? number.replace(/^0+(?=\d)/, "") : number;
  const code = codeBySet.get(normaliseName(setId));
  const promo = PROMO_CODE.exec(setId);

  // Gallery numbers already contain the subset prefix, such as TG01.
  if (code) return `${code.split(":")[0]} ${bare}`;
  if (promo) return `P-${promo[1]!.toUpperCase()} ${bare}`;
  if (POCKET_SET.test(setId)) return `${setId.toUpperCase()} ${bare}`;
  return cardId;
}
