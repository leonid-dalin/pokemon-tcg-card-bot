import type { Card } from "./api/types.js";
import { setIdOf } from "./resolve.js";

// Recognise regular Pocket sets and both package and hyphenated promo prefixes.
const POCKET_SET = /^(?:[abc]\d+[a-z]?|p[abc]?-[abc]?|p[abc])$/i;

/** Classifies a card by its set-ID pattern. */
export function isPocketCard(card: Card): boolean {
  return POCKET_SET.test(setIdOf(card.id));
}

/** Classifies a resolved set id as a Pocket set. */
export function isPocketSet(setId: string): boolean {
  return POCKET_SET.test(setId);
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
