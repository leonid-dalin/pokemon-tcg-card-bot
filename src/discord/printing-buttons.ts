import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { CardSummary } from "../api/types.js";
import { printedNumber } from "../printed.js";

export const PRINTING_PREFIX = "printing:";
const MAX_BUTTONS = 5;

/**
 * One row of buttons for the other printings of a card. The custom id carries
 * the card id, so the handler resolves it with the same lookup a hint uses and
 * needs no state of its own.
 */
export function printingRows(alternates: CardSummary[]): ActionRowBuilder<ButtonBuilder>[] {
  // Discord rejects a message whose components repeat a custom id, so a
  // printing listed twice would sink the whole reply.
  const unique = [...new Map(alternates.map((card) => [card.id, card])).values()];
  const shown = unique.slice(0, MAX_BUTTONS);
  if (shown.length === 0) return [];

  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const card of shown) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PRINTING_PREFIX}${card.id}`)
        .setLabel(printedNumber(card.id))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return [row];
}

/**
 * Buttons for a reply to `[[...]]` mentions. A press swaps the whole message for
 * one printing, so buttons only appear when the reply shows a single card.
 */
export function mentionRows(lookups: { alternates: CardSummary[] }[]): ActionRowBuilder<ButtonBuilder>[] {
  const [only] = lookups;
  return lookups.length === 1 && only ? printingRows(only.alternates) : [];
}

export function printingIdFrom(customId: string): string | undefined {
  if (!customId.startsWith(PRINTING_PREFIX)) return undefined;
  const id = customId.slice(PRINTING_PREFIX.length).trim();
  return id.length > 0 ? id : undefined;
}
