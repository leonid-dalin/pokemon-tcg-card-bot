import type { CardSetRef, CardSummary } from "./api/types.js";
import type { PageStore } from "./discord/pages.js";
import { listReply } from "./discord/pages.js";

export interface SetCard extends CardSummary {
  localId?: string;
}

/** Set metadata with the card summaries used by a checklist. */
export interface SetWithCards extends CardSetRef {
  cards?: SetCard[];
}

const CHECKLIST_PER_PAGE = 15;

/**
 * Stores the complete checklist in source order and renders its first page.
 */
export function setChecklistReply(set: SetWithCards, ownerId: string, attribution: string, pages: PageStore) {
  const cards = set.cards ?? [];
  const items = cards.map((card) => ({
    cardId: card.id,
    heading: `${numberOf(card)} ${card.name}`,
  }));
  const page = {
    title: `${set.name} checklist`,
    items,
    perPage: CHECKLIST_PER_PAGE,
    ownerId,
    footer: attribution,
  };
  const token = pages.put(page);
  return listReply(page, token, 0);
}

// Prefer the supplied local ID and strip leading zeros only from numeric values.
function numberOf(card: SetCard): string {
  const raw = card.localId ?? card.id.slice(card.id.lastIndexOf("-") + 1);
  return /^\d+$/.test(raw) ? raw.replace(/^0+(?=\d)/, "") : raw;
}
