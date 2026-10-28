import type { CardSummary } from "../api/types.js";
import { printedNumber } from "../printed.js";
import { isImageOnly, lookupEmbeds, type CardLookup } from "../lookup.js";
import { matchingDetail, unquote, type TextGroup } from "../text-search.js";
import { toEmbeds } from "./embeds.js";
import { listReply, type ListPage, type PageStore } from "./pages.js";
import { detailsRow, detailsRows, missMenu, printingRows } from "./printing-buttons.js";

/** Most embeds Discord accepts in one message is ten; five keeps a reply readable. */
export const MAX_EMBEDS_PER_MESSAGE = 5;

/** One card with its printing buttons, as `/card` and a printing button show it. */
export function cardReply(lookup: CardLookup, ownerId?: string) {
  const components = isImageOnly(lookup)
    ? []
    : [...printingRows(lookup.matchingPrintings ?? lookup.alternates, ownerId), ...detailsRow(lookup.card.id)];
  return {
    embeds: toEmbeds(lookupEmbeds(lookup)),
    ...(components.length > 0 ? { components } : {}),
  };
}

/** Discord rejects an embed title over 256 characters, and the count plus quotes take the rest. */
const TITLE_LIMIT = 80;

/** More than this is more than anyone scrolls, and every row costs a search of its own. */
const MAX_ITEMS = 250;

/** A text search answer, shared by `/search` and `@bot search`. */
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
    footer: groups.length > MAX_ITEMS ? `${attribution} · the first ${MAX_ITEMS} of ${groups.length}` : attribution,
    filterable: shown.some((group) => group.representative.category !== undefined),
    categoryCounts,
  };
  const token = pages.put(page);
  return listReply(page, token, 0);
}

/** The storage cap, which bounds every category view as well as the overall list. */
const CAP = MAX_ITEMS;

/**
 * What a search stores: the first CAP hits overall, plus the first CAP of each
 * category in original order, deduplicated. Filtering then reaches the late
 * categories instead of losing them to the overall cap, while storage stays
 * bounded (at most four caps for the three categories plus all).
 */
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

/** Category totals over every match, before any cap: what the filter menu promises. */
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

/**
 * The reply to a message's `[[...]]` mentions. A name that resolves to nothing
 * still gets a line, because silence after an explicit request reads as a
 * broken bot.
 */
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
