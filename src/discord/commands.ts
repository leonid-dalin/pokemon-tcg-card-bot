import {
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { TcgdexClient } from "../api/tcgdex.js";
import { CARD_ID, lookupById, lookupCard, POCKET_ATTRIBUTION } from "../lookup.js";
import { renderCardDetails, renderSet } from "../render.js";
import { printedNumber } from "../printed.js";
import { searchCardGroups } from "../text-search.js";
import { printingItems, printingsOf } from "../printings.js";
import { setChecklistReply } from "../set-checklist.js";
import { helpView } from "../help.js";
import { printingIdFrom, detailsIdFrom, cardmarketRow, MISS_MENU_ID, MISS_MENU_PREFIX } from "./printing-buttons.js";
import { rankPrintings } from "../resolve.js";
import { toEmbed } from "./embeds.js";
import { listReply, filterTokenFrom, pageFilterFrom, pageIndexFrom, pageTokenFrom, type ListPage, type PageStore } from "./pages.js";
import { cardReply, searchReply } from "./replies.js";

export interface CommandContext {
  client: TcgdexClient;
  attribution: string;
  energyEmoji: Record<string, string>;
  pages: PageStore;
}

export const cardCommand = new SlashCommandBuilder()
  .setName("card")
  .setDescription("Show a Pokémon TCG card")
  .addStringOption((option) =>
    option
      .setName("name")
      .setDescription("Card name, for example Dragapult ex")
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((option) =>
    option
      .setName("set")
      .setDescription("Optional set id to pin one printing, for example sv08.5")
      .setRequired(false),
  );

export const setCommand = new SlashCommandBuilder()
  .setName("set")
  .setDescription("Show a Pokémon TCG set")
  .addStringOption((option) =>
    option
      .setName("id")
      .setDescription("Set id, for example sv08.5")
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addBooleanOption((option) =>
    option
      .setName("checklist")
      .setDescription("List every card in the set instead of the set summary")
      .setRequired(false),
  );

export const searchCommand = new SlashCommandBuilder()
  .setName("search")
  .setDescription("Find cards by what their abilities and attacks say")
  .addStringOption((option) =>
    option
      .setName("text")
      .setDescription('Wording to look for, for example "search your deck for a Supporter"')
      .setRequired(true),
  );

export const printingsCommand = new SlashCommandBuilder()
  .setName("printings")
  .setDescription("List every printing of a card")
  .addStringOption((option) =>
    option
      .setName("name")
      .setDescription("Card name, for example Dragapult ex")
      .setRequired(true)
      .setAutocomplete(true),
  );

export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("List what the bot can do");

export const commandDefinitions = [cardCommand, setCommand, searchCommand, printingsCommand, helpCommand];

export async function handleAutocomplete(
  context: CommandContext,
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const query = String(focused.value ?? "").trim();
  if (query.length < 2) {
    await interaction.respond([]);
    return;
  }

  if (focused.name === "id") {
    const sets = await context.client.listSets();
    const matches = sets
      .filter((set) => set.id.toLowerCase().includes(query.toLowerCase()) || set.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 25)
      .map((set) => ({ name: `${set.name} (${set.id})`.slice(0, 100), value: set.id }));
    await interaction.respond(matches);
    return;
  }

  const summaries = await context.client.searchByName(query);
  const ranked = rankPrintings(summaries, query).slice(0, 25);
  await interaction.respond(
    ranked.map((card) => ({ name: `${card.name} · ${printedNumber(card.id)}`.slice(0, 100), value: card.id })),
  );
}

export async function handleCardCommand(
  context: CommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const query = interaction.options.getString("name", true).trim();
  const setHint = interaction.options.getString("set")?.trim() || undefined;

  await interaction.deferReply();
  // Autocomplete lists card ids, so a picked printing has to be pinned rather
  // than searched for by the id text as if it were a name.
  const lookup = CARD_ID.test(query)
    ? await lookupById(context.client, query, { attribution: context.attribution, energyEmoji: context.energyEmoji })
    : await lookupCard(context.client, query, setHint, { attribution: context.attribution, energyEmoji: context.energyEmoji });
  if (!lookup) {
    await interaction.editReply({ content: `No card matched \`${query}\`.` });
    return;
  }
  await interaction.editReply(cardReply(lookup, interaction.user.id));
}

/** A printing button swaps the card message for the printing it names. */
export async function handlePrintingButton(
  context: CommandContext,
  interaction: ButtonInteraction,
): Promise<void> {
  const parsed = printingIdFrom(interaction.customId);
  if (!parsed) return;
  if (parsed.ownerId && parsed.ownerId !== interaction.user.id) {
    await interaction.reply({
      content: "Only the person who asked can change this. Ask for your own copy with [[name]] or /card.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferUpdate();
  const lookup = await lookupById(context.client, parsed.cardId, { attribution: context.attribution, energyEmoji: context.energyEmoji });
  if (!lookup) {
    await interaction.followUp({ content: `No card matched \`${parsed.cardId}\`.`, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.editReply(cardReply(lookup, parsed.ownerId));
}

export async function handleDetailsButton(
  context: CommandContext,
  interaction: ButtonInteraction,
): Promise<void> {
  const id = detailsIdFrom(interaction.customId);
  if (!id) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const lookup = await lookupById(context.client, id, { attribution: context.attribution, energyEmoji: context.energyEmoji });
  if (!lookup) {
    await interaction.editReply({ content: `No card matched \`${id}\`.` });
    return;
  }
  // A Pocket card answers with the Pocket source, so the footer has to follow the lookup.
  await interaction.editReply({
    embeds: [toEmbed(renderCardDetails(lookup.card, lookup.alternates, { attribution: lookup.attribution ?? context.attribution }))],
    ...(cardmarketRow(lookup.card.id, lookup.card.name) ? { components: [cardmarketRow(lookup.card.id, lookup.card.name)!] } : {}),
  });
}
export async function handlePageButton(
  context: CommandContext,
  interaction: ButtonInteraction,
): Promise<void> {
  const token = pageTokenFrom(interaction.customId);
  const index = pageIndexFrom(interaction.customId);
  if (!token || index === undefined) return;
  const page = context.pages.get(token);
  if (!page) {
    await interaction.reply({ content: "This list has expired. Run the command again.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (page.ownerId !== interaction.user.id) {
    await interaction.reply({ content: "Only the person who asked can change this. Ask for your own copy with [[name]] or /card.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.update(listReply(page, token, index, pageFilterFrom(interaction.customId)));
}

/** Narrowing a search to Pokemon, Trainers or Energy is a view change, so it edits the message in place. */
export async function handleFilterMenu(
  context: CommandContext,
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  // The chosen category is the menu's value; the custom id only carries the token.
  const filter = interaction.values[0];
  const token = filterTokenFrom(interaction.customId);
  if (!filter || !token) return;
  const page = context.pages.get(token);
  if (!page) {
    await interaction.reply({ content: "This list has expired. Run the command again.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (page.ownerId !== interaction.user.id) {
    await interaction.reply({ content: "Only the person who asked can change this. Ask for your own copy with [[name]] or /card.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.update(listReply(page, token, 0, filter));
}

export async function handleOpenCardMenu(
  context: CommandContext,
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const cardId = interaction.values[0];
  if (!cardId) return;
  if (interaction.customId !== MISS_MENU_ID && !interaction.customId.startsWith(MISS_MENU_PREFIX)) {
    const token = pageTokenFrom(interaction.customId);
    if (!token) return;
    if (!context.pages.get(token)) {
      await interaction.reply({ content: "This list has expired. Run the command again.", flags: MessageFlags.Ephemeral });
      return;
    }
  }
  // The lookup goes to TCGdex, which can outlast the three seconds a component
  // has to answer.
  await interaction.deferReply();
  const lookup = await lookupById(context.client, cardId, { attribution: context.attribution, energyEmoji: context.energyEmoji });
  if (!lookup) {
    await interaction.editReply({ content: `No card matched \`${cardId}\`.` });
    return;
  }
  await interaction.editReply(cardReply(lookup, interaction.user.id));
}

export async function handleSearchCommand(
  context: CommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const query = interaction.options.getString("text", true).trim();
  await interaction.deferReply();
  await interaction.editReply(searchReply(query, searchCardGroups(query), context.attribution, interaction.user.id, context.pages));
}

export async function handleSetCommand(
  context: CommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const id = interaction.options.getString("id", true).trim();
  const checklist = interaction.options.getBoolean("checklist") ?? false;

  await interaction.deferReply();
  try {
    const set = await context.client.getSet(id);
    if (checklist) {
      await interaction.editReply(setChecklistReply(set, interaction.user.id, context.attribution, context.pages));
      return;
    }
    await interaction.editReply({ embeds: [toEmbed(renderSet(set, context.attribution))] });
  } catch {
    await interaction.editReply({ content: `No set matched \`${id}\`.` });
  }
}

export async function handleHelpCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ embeds: [toEmbed(helpView())] });
}

/** Pocket ids are `a1-001` or `p-a-001`; TCGdex ids never start with those sets. */
const POCKET_ID = /^(?:[ab]\d+[a-z]?|p-[ab])-/i;

/** Both sources get named when the list mixes them, since each row came from one or the other. */
function footerFor(printings: { id: string }[], attribution: string): string {
  const pocket = printings.some((printing) => POCKET_ID.test(printing.id));
  const physical = printings.some((printing) => !POCKET_ID.test(printing.id));
  if (pocket && physical) return `${attribution} · Pocket cards from pokemon-tcg-pocket-cards`;
  return pocket ? POCKET_ATTRIBUTION : attribution;
}

export async function handlePrintingsCommand(
  context: CommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const query = interaction.options.getString("name", true).trim();
  await interaction.deferReply();

  // A picked autocomplete entry is a card id, so resolve it first and list that
  // card's name; a typed name goes straight to the listing.
  const pinned = CARD_ID.test(query) ? await lookupById(context.client, query, { attribution: context.attribution }) : undefined;
  const printings = await printingsOf(context.client, pinned?.card.name ?? query);
  if (printings.length === 0) {
    await interaction.editReply({ content: `No card matched \`${query}\`.` });
    return;
  }

  const page: ListPage = {
    title: `${printings.length} ${printings.length === 1 ? "printing" : "printings"} of ${printings[0]!.name}`,
    items: printingItems(printings),
    perPage: 10,
    ownerId: interaction.user.id,
    // A mixed list has to credit both sources, or the footer hides where half the rows came from.
    footer: footerFor(printings, context.attribution),
  };
  const token = context.pages.put(page);
  await interaction.editReply(listReply(page, token, 0));
}
