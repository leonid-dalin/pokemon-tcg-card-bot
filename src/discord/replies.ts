import type { CardSummary } from "../api/types.js";
import { printedNumber } from "../printed.js";
import { isImageOnly, lookupEmbeds, type CardLookup } from "../lookup.js";
import { matchingDetail, unquote, type TextGroup } from "../text-search.js";
import { toEmbeds } from "./embeds.js";
import { listReply, type ListPage, type PageStore } from "./pages.js";
import { detailsRow, detailsRows, missMenu, printingRows } from "./printing-buttons.js";

/** Maximum embeds included in one mention reply. */
export const MAX_EMBEDS_PER_MESSAGE = 5;

/** Builds a card reply with printing buttons that carry the optional owner ID. */
export function cardReply(lookup: CardLookup, ownerId?: string) {
  const components = isImageOnly(lookup)
    ? []
    : [...printingRows(lookup.matchingPrintings ?? lookup.alternates, ownerId), ...detailsRow(lookup.card.id)];
  return {
    embeds: toEmbeds(lookupEmbeds(lookup)),
    ...(components.length > 0 ? { components } : {}),
  };
}

/** Maximum query excerpt length in a search title. */
const TITLE_LIMIT = 80;

/** Maximum search results shown in one list view. */
const MAX_ITEMS = 250;

/** Stores bounded search results and renders the first page or a no-match response. */
export function searchReply(
  query: string,
  groups: TextGroup[],
  attribution: string,
  ownerId: string,
  pages: PageStore,
) {
  if (groups.length === 0) {
    const words = unquote(query);
    const quoted = words !== query.trim();
    const base = `No card wording mentions \`${words}\`.`;
    return { content: quoted ? `${base} A quoted search needs those words printed in that order.` : base };
  }
  const shown = shownGroups(groups);
  const categoryCounts = universeCounts(groups);
  const page: ListPage = {
    title: `${groups.length} cards mention "${unquote(query).slice(0, TITLE_LIMIT)}"`,
    items: shown.map(({ representative, printings }) => ({
      cardId: representative.id,
      heading: `**${representative.name}** · ${printedNumber(representative.id)}${printings > 1 ? ` · ${printings} printings` : ""}`,
      detail: matchingDetail(representative, query),
      ...(representative.category ? { category: representative.category } : {}),
    })),
    perPage: 5,
    ownerId,
    footer: attribution,
    filterable: shown.some((group) => group.representative.category !== undefined),
    categoryCounts,
    universeTotal: groups.length,
    displayCap: MAX_ITEMS,
  };
  const token = pages.put(page);
  return listReply(page, token, 0);
}

/** Maximum results retained per category and for the overall search. */
const CAP = MAX_ITEMS;

// Retain the union of the first CAP overall hits and the first CAP per category.
function shownGroups(groups: TextGroup[]): TextGroup[] {
  const keep = new Set(groups.slice(0, CAP).map((group) => group.representative.id));
  for (const category of ["Pokemon", "Trainer", "Energy"]) {
    let counted = 0;
    for (const group of groups) {
      if (group.representative.category !== category) continue;
      if (counted >= CAP) break;
      keep.add(group.representative.id);
      counted += 1;
    }
  }
  return groups.filter((group) => keep.has(group.representative.id));
}

// Count the complete result set before applying storage or display caps.
function universeCounts(groups: TextGroup[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const group of groups) {
    const category = group.representative.category;
    if (category) counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
}

export interface MentionMiss {
  raw: string;
  closest: CardSummary[];
}

/** Builds a mention reply with card embeds and feedback for unmatched names. */
export function mentionReply(found: CardLookup[], misses: MentionMiss[], ownerId?: string) {
  const embeds = found.flatMap((lookup) => toEmbeds(lookupEmbeds(lookup))).slice(0, MAX_EMBEDS_PER_MESSAGE);
  const content = misses
    .map(({ raw, closest }) => {
      const base = `No card matched \`${raw}\`.`;
      return closest.length === 0 ? base : `${base} Pick the closest below.`;
    })
    .join("\n");
  const components = [
    ...(found.length === 1 && found[0]
      ? isImageOnly(found[0])
        ? []
        : [...printingRows(found[0].matchingPrintings ?? found[0].alternates, ownerId), ...detailsRow(found[0].card.id)]
      : detailsRows(found.filter((lookup) => !isImageOnly(lookup)))),
    ...misses.flatMap((miss, index) => missMenu(miss.closest, index)),
  ];
  return {
    ...(embeds.length > 0 ? { embeds } : {}),
    ...(content ? { content } : {}),
    ...(components.length > 0 ? { components } : {}),
  };
}
