import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { TcgdexClient } from "../api/tcgdex.js";
import { lookupCard, lookupEmbeds } from "../lookup.js";
import { renderSearchResults, renderSet } from "../render.js";
import { printingRows } from "./printing-buttons.js";
import { rankPrintings } from "../resolve.js";
import { toEmbed, toEmbeds } from "./embeds.js";

export interface CommandContext {
  client: TcgdexClient;
  attribution: string;
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

export const commandDefinitions = [cardCommand, setCommand, searchCommand];

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
    ranked.map((card) => ({ name: `${card.name} · ${card.id}`.slice(0, 100), value: card.id })),
  );
}

export async function handleCardCommand(
  context: CommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const query = interaction.options.getString("name", true).trim();
  const setHint = interaction.options.getString("set")?.trim() || undefined;

  await interaction.deferReply();
  const lookup = await lookupCard(context.client, query, setHint, { attribution: context.attribution });
  if (!lookup) {
    await interaction.editReply({ content: `No card matched \`${query}\`.` });
    return;
  }
  await interaction.editReply({
    embeds: toEmbeds(lookupEmbeds(lookup)),
    components: printingRows(lookup.alternates),
  });
}

export async function handleSearchCommand(
  context: CommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const text = interaction.options.getString("text", true).trim();

  await interaction.deferReply();
  const cards = await context.client.searchByEffect(text);
  if (cards.length === 0) {
    await interaction.editReply({ content: `No card wording mentions \`${text}\`.` });
    return;
  }
  await interaction.editReply({ embeds: [toEmbed(renderSearchResults(text, cards))] });
}

export async function handleSetCommand(
  context: CommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const id = interaction.options.getString("id", true).trim();

  await interaction.deferReply();
  try {
    const set = await context.client.getSet(id);
    await interaction.editReply({ embeds: [toEmbed(renderSet(set))] });
  } catch {
    await interaction.editReply({ content: `No set matched \`${id}\`.` });
  }
}
