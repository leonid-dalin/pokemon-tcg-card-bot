import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { CardSummary } from "../api/types.js";
import { printedNumber } from "../printed.js";

export const PRINTING_PREFIX = "printing:";
export const DETAILS_PREFIX = "details:";
const MAX_BUTTONS = 5;

export interface PrintingButtonId {
  cardId: string;
  ownerId?: string;
}

export function printingRows(alternates: CardSummary[], ownerId?: string): ActionRowBuilder<ButtonBuilder>[] {
  const unique = [...new Map(alternates.map((card) => [card.id, card])).values()];
  const shown = unique.slice(0, MAX_BUTTONS);
  if (shown.length === 0) return [];

  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const card of shown) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PRINTING_PREFIX}${card.id}${ownerId ? `:${ownerId}` : ""}`)
        .setLabel(printedNumber(card.id))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return [row];
}

export function detailsRow(cardId: string, label = "Details"): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${DETAILS_PREFIX}${cardId}`).setLabel(label).setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function detailsRows(lookups: { card: { id: string; name: string } }[]): ActionRowBuilder<ButtonBuilder>[] {
  if (lookups.length === 0) return [];
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const lookup of lookups.slice(0, MAX_BUTTONS)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${DETAILS_PREFIX}${lookup.card.id}`)
        .setLabel(`Details · ${lookup.card.name}`.slice(0, 80))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return [row];
}

export function mentionRows(lookups: { card: { id: string }; alternates: CardSummary[] }[], ownerId?: string): ActionRowBuilder<ButtonBuilder>[] {
  const [only] = lookups;
  if (lookups.length !== 1 || !only) return [];
  return [...printingRows(only.alternates, ownerId), ...detailsRow(only.card.id)];
}

export function printingIdFrom(customId: string): PrintingButtonId | undefined {
  if (!customId.startsWith(PRINTING_PREFIX)) return undefined;
  const value = customId.slice(PRINTING_PREFIX.length).trim();
  const [cardId, ownerId, ...extra] = value.split(":");
  if (!cardId || extra.length > 0) return undefined;
  return { cardId, ...(ownerId ? { ownerId } : {}) };
}

export function detailsIdFrom(customId: string): string | undefined {
  if (!customId.startsWith(DETAILS_PREFIX)) return undefined;
  const id = customId.slice(DETAILS_PREFIX.length).trim();
  return id.length > 0 ? id : undefined;
}
