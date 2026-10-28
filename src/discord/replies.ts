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
    : [...printingRows(lookup.alternates, ownerId), ...detailsRow(lookup.card.id)];
  return {
    embeds: toEmbeds(lookupEmbeds(lookup)),
    ...(components.length > 0 ? { components } : {}),
  };
}

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
    const base = `No card wording mentions \`${quoted ? words : query}\`.`;
    // A query that is still quoted at this point could only match a card that
    // prints the marks, so say what was searched instead of blaming the cards.
    return { content: quoted ? `${base} The words were searched; the quote marks are matched literally, so a card would have to print them.` : base };
  }
  const page: ListPage = {
    title: `${groups.length} cards mention "${unquote(query)}"`,
    items: groups.map(({ representative, printings }) => ({
      cardId: representative.id,
      heading: `**${representative.name}** · ${printedNumber(representative.id)}${printings > 1 ? ` · ${printings} printings` : ""}`,
      detail: matchingDetail(representative, query),
      ...(representative.category ? { category: representative.category } : {}),
    })),
    perPage: 5,
    ownerId,
    footer: attribution,
    filterable: groups.some((group) => group.representative.category !== undefined),
  };
  const token = pages.put(page);
  return listReply(page, token, 0);
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
        : [...printingRows(found[0].alternates, ownerId), ...detailsRow(found[0].card.id)]
      : detailsRows(found.filter((lookup) => !isImageOnly(lookup)))),
    ...misses.flatMap((miss) => missMenu(miss.closest)),
  ];
  return {
    ...(embeds.length > 0 ? { embeds } : {}),
    ...(content ? { content } : {}),
    ...(components.length > 0 ? { components } : {}),
  };
}
