import type { Card } from "./api/types.js";
import { setIdOf } from "./resolve.js";

/**
 * The one Pocket set-id pattern: regular sets (a1, b2a, c1), hyphenated promo
 * sets (p-a, pc) and bare package promos (pa, pb, pc). Every consumer imports
 * this rather than keeping a copy that can drift.
 */
const POCKET_SET = /^(?:[abc]\d+[a-z]?|p[abc]?-[abc]?|p[abc])$/i;

export function isPocketCard(card: Card): boolean {
  return POCKET_SET.test(setIdOf(card.id));
}

export function isPocketSet(setId: string): boolean {
  return POCKET_SET.test(setId);
}

export function isPocketCardId(cardId: string): boolean {
  return POCKET_SET.test(setIdOf(cardId));
}

/** Uses explicit Pocket points or infers the knockout reward from the card name. */
export function prizeCount(card: Card): number {
  if (isPocketCard(card) && card.points !== undefined) return card.points;
  const name = card.name;
  if (/^Mega .+ ex$/i.test(name)) return 3;
  if (/(?:VMAX|V-UNION)$/i.test(name)) return 3;
  if (name.includes("&") && /GX$/i.test(name)) return 3;
  // Require a suffix boundary to exclude ordinary names such as Toxapex.
  if (/(?:^|[\s-])(?:EX|GX|VSTAR|V|ex)$/i.test(name)) return 2;
  return 1;
}
