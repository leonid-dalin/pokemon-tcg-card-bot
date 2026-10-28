import type { CardSummary } from "../api/types.js";
import { printedNumber } from "../printed.js";
import { lookupEmbeds, type CardLookup } from "../lookup.js";
import { matchingSentence, type TextGroup } from "../text-search.js";
import { toEmbeds } from "./embeds.js";
import { listReply, type ListPage, type PageStore } from "./pages.js";
import { detailsRow, detailsRows, printingRows } from "./printing-buttons.js";

/** Most embeds Discord accepts in one message is ten; five keeps a reply readable. */
export const MAX_EMBEDS_PER_MESSAGE = 5;

/** One card with its printing buttons, as `/card` and a printing button show it. */
export function cardReply(lookup: CardLookup, ownerId?: string) {
  return {
    embeds: toEmbeds(lookupEmbeds(lookup)),
    components: [...printingRows(lookup.alternates, ownerId), ...detailsRow(lookup.card.id)],
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
  if (groups.length === 0) return { content: `No card wording mentions \`${query}\`.` };
  const page: ListPage = {
    title: `${groups.length} cards mention \"${query}\"`,
    items: groups.map(({ representative, printings }) => ({
      cardId: representative.id,
      heading: `**${representative.name}** · ${printedNumber(representative.id)}${printings > 1 ? ` · ${printings} printings` : ""}`,
      detail: matchingSentence(representative.text, query),
    })),
    perPage: 5,
    ownerId,
    footer: attribution,
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
      if (closest.length === 0) return base;
      return `${base} Closest: ${closest.map((card) => `\`${card.name}\` (${printedNumber(card.id)})`).join(", ")}.`;
    })
    .join("\n");
  const components = found.length === 1 && found[0]
    ? [...printingRows(found[0].alternates, ownerId), ...detailsRow(found[0].card.id)]
    : detailsRows(found);
  return {
    ...(embeds.length > 0 ? { embeds, components } : {}),
    ...(content ? { content } : {}),
  };
}
