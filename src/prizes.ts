import type { Card } from "./api/types.js";
import { setIdOf } from "./resolve.js";

const POCKET_SET = /^(?:[ab]\d+[a-z]?|p-[ab])$/i;

export function isPocketCard(card: Card): boolean {
  return POCKET_SET.test(setIdOf(card.id));
}

export function prizeCount(card: Card): number {
  if (isPocketCard(card) && card.points !== undefined) return card.points;
  const name = card.name;
  if (/^Mega .+ ex$/i.test(name)) return 3;
  if (/(?:VMAX|V-UNION)$/i.test(name)) return 3;
  if (name.includes("&") && /GX$/i.test(name)) return 3;
  if (/(?:EX|GX|VSTAR|V|ex)$/i.test(name)) return 2;
  return 1;
}