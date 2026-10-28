import type { EmbedBuilder } from "discord.js";
import type { CardSummary } from "../api/types.js";
import { printedNumber } from "../printed.js";
import { lookupEmbeds, type CardLookup } from "../lookup.js";
import { renderSearchResults } from "../render.js";
import type { TextHit } from "../text-search.js";
import { toEmbeds } from "./embeds.js";
import { mentionRows, printingRows } from "./printing-buttons.js";

/** Most embeds Discord accepts in one message is ten; five keeps a reply readable. */
export const MAX_EMBEDS_PER_MESSAGE = 5;

/** One card with its printing buttons, as `/card` and a printing button show it. */
export function cardReply(lookup: CardLookup) {
  return { embeds: toEmbeds(lookupEmbeds(lookup)), components: printingRows(lookup.alternates) };
}

/** A text search answer, shared by `/search` and `@bot search`. */
export function searchReply(
  query: string,
  hits: TextHit[],
  attribution: string,
): { content: string } | { embeds: EmbedBuilder[] } {
  if (hits.length === 0) return { content: `No card wording mentions \`${query}\`.` };
  return { embeds: toEmbeds([renderSearchResults(query, hits, attribution)]) };
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
export function mentionReply(found: CardLookup[], misses: MentionMiss[]) {
  const embeds = found.flatMap((lookup) => toEmbeds(lookupEmbeds(lookup))).slice(0, MAX_EMBEDS_PER_MESSAGE);
  const content = misses
    .map(({ raw, closest }) => {
      const base = `No card matched \`${raw}\`.`;
      if (closest.length === 0) return base;
      return `${base} Closest: ${closest.map((card) => `\`${card.name}\` (${printedNumber(card.id)})`).join(", ")}.`;
    })
    .join("\n");
  return {
    ...(embeds.length > 0 ? { embeds, components: mentionRows(found) } : {}),
    ...(content ? { content } : {}),
  };
}
