import {
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { TcgdexClient } from "../api/tcgdex.js";
import { isCardId, lookupById, lookupCard, POCKET_ATTRIBUTION } from "../lookup.js";
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
import { settingsCommand } from "./settings-command.js";
import { buildIdentity, formatUptime } from "../version.js";
import { ratesDate } from "../currency.js";

import { busyMessage, overloadHint } from "./interaction-failure.js";

const SOURCE_LABEL = { env: "deployed", build: "bundle", git: "checkout", package: "package version" } as const;

const AUTOCOMPLETE_DEADLINE_MS = 2000;

export interface CommandContext {
  client: TcgdexClient;
  attribution: string;
  energyEmoji: Record<string, string>;
  pages: PageStore;
  settings?: {
    get: (guildId: string) => import("../settings-store.js").GuildSettings;
    resolveCurrency: (userId: string, guildId: string | null) => import("../settings-store.js").Currency;
  } | undefined;
  /** Guild-scoped member budget for expensive lookups; absent means unmetered. */
  requests?: {
    take: (key: string) => { allowed: true } | { allowed: false; retryAfterSeconds: number };
  } | undefined;
  /** Separate, smaller allowance for autocomplete so typing cannot spend the command budget. */
  typing?: {
    take: (key: string) => { allowed: true } | { allowed: false; retryAfterSeconds: number };
  } | undefined;
}

/** Admits an expensive lookup, or reports the wait so the caller can answer before starting work. */
function admitRequest(
  context: CommandContext,
  guildId: string | null,
  userId: string,
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  if (!context.requests) return { allowed: true };
  return context.requests.take(budgetKey(guildId, userId));
}

function admitTyping(context: CommandContext, guildId: string | null, userId: string): boolean {
  if (!context.typing) return true;
  return context.typing.take(budgetKey(guildId, userId)).allowed;
}

/** A direct message has no guild, so its allowance is keyed per member instead of skipping the budget. */
function budgetKey(guildId: string | null, userId: string): string {
  return guildId ? `${guildId}:${userId}` : `dm:${userId}`;
}

/** Reads the per-server game preference; explicit hints and exact IDs bypass it. */
function gamePreference(context: CommandContext, guildId: string | null) {
  if (!guildId || !context.settings) return undefined;
  const settings = context.settings.get(guildId);
  return { allowed: settings.cardGames, default: settings.defaultCardGame };
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

export const versionCommand = new SlashCommandBuilder()
  .setName("version")
  .setDescription("Show the running revision, uptime and data version");

export const commandDefinitions = [cardCommand, setCommand, searchCommand, printingsCommand, helpCommand, versionCommand, settingsCommand];

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

  // Typing shares one small allowance so a long name cannot spend the command's budget.
  const typing = admitTyping(context, interaction.guildId, interaction.user.id);
  if (!typing) {
    await interaction.respond([]);
    return;
  }

  if (focused.name === "id") {
    // Discord wants an autocomplete answer within three seconds, so do not wait the full queue deadline.
    const sets = await Promise.race([
      context.client.listSets(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), AUTOCOMPLETE_DEADLINE_MS)),
    ]);
    if (!sets) {
      await interaction.respond([]);
      return;
    }
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
  const admission = admitRequest(context, interaction.guildId, interaction.user.id);
  if (!admission.allowed) {
    await interaction.editReply({ content: busyMessage(admission.retryAfterSeconds) });
    return;
  }
  // Look up autocomplete values by card id.
  const preference = gamePreference(context, interaction.guildId);
  const lookup = isCardId(query)
    ? await lookupById(context.client, query, { attribution: context.attribution, energyEmoji: context.energyEmoji })
    : await lookupCard(context.client, query, setHint, { attribution: context.attribution, energyEmoji: context.energyEmoji, ...(preference ? { gamePreference: preference } : {}) });
  if (!lookup) {
    await interaction.editReply({ content: `No card matched \`${query}\`.` });
    return;
  }
  await interaction.editReply(cardReply(lookup, interaction.user.id));
}

/** Replaces the card reply after checking the printing button's optional owner ID. */
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
  const admission = admitRequest(context, interaction.guildId, interaction.user.id);
  if (!admission.allowed) {
    await interaction.followUp({ content: busyMessage(admission.retryAfterSeconds), flags: MessageFlags.Ephemeral });
    return;
  }
  const lookup = await lookupById(context.client, parsed.cardId, { attribution: context.attribution, energyEmoji: context.energyEmoji });
  if (!lookup) {
    await interaction.followUp({ content: `No card matched \`${parsed.cardId}\`.`, flags: MessageFlags.Ephemeral });
    return;
  }
  // Clear the original miss prompt when replacing the reply.
  await interaction.editReply({ ...cardReply(lookup, parsed.ownerId), content: null });
}

export async function handleDetailsButton(
  context: CommandContext,
  interaction: ButtonInteraction,
): Promise<void> {
  const id = detailsIdFrom(interaction.customId);
  if (!id) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const admission = admitRequest(context, interaction.guildId, interaction.user.id);
  if (!admission.allowed) {
    await interaction.editReply({ content: busyMessage(admission.retryAfterSeconds) });
    return;
  }
  const lookup = await lookupById(context.client, id, { attribution: context.attribution, energyEmoji: context.energyEmoji });
  if (!lookup) {
    await interaction.editReply({ content: `No card matched \`${id}\`.` });
    return;
  }
  // Use the lookup's source attribution for Pocket cards.
  await interaction.editReply({
    embeds: [
      toEmbed(
        renderCardDetails(lookup.card, lookup.alternates, {
          attribution: lookup.attribution ?? context.attribution,
          currency: context.settings?.resolveCurrency(interaction.user.id, interaction.guildId) ?? "EUR",
        }),
      ),
    ],
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

/** Applies the selected category after checking list ownership and expiry. */
export async function handleFilterMenu(
  context: CommandContext,
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  // The category is the selected value; the custom id carries the page token.
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
  // A card lookup may exceed Discord's three-second interaction response window.
  await interaction.deferReply();
  const admission = admitRequest(context, interaction.guildId, interaction.user.id);
  if (!admission.allowed) {
    await interaction.editReply({ content: busyMessage(admission.retryAfterSeconds) });
    return;
  }
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
  const admission = admitRequest(context, interaction.guildId, interaction.user.id);
  if (!admission.allowed) {
    await interaction.editReply({ content: busyMessage(admission.retryAfterSeconds) });
    return;
  }
  try {
    const set = await context.client.getSet(id);
    if (checklist) {
      await interaction.editReply(setChecklistReply(set, interaction.user.id, context.attribution, context.pages));
      return;
    }
    await interaction.editReply({ embeds: [toEmbed(renderSet(set, context.attribution))] });
  } catch (error) {
    const hint = overloadHint(error);
    if (hint !== undefined) {
      await interaction.editReply({ content: busyMessage(hint) });
      return;
    }
    await interaction.editReply({ content: `No set matched \`${id}\`.` });
  }
}

export async function handleHelpCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ embeds: [toEmbed(helpView())] });
}

/** The revision, package version, build date, uptime and rate-snapshot age. */
export function versionLines(startedAt = Date.now() - process.uptime() * 1_000, now = Date.now()): string[] {
  const identity = buildIdentity();
  return [
    `Revision: ${identity.label} (${SOURCE_LABEL[identity.source]})`,
    identity.packageVersion ? `Version: ${identity.packageVersion}` : undefined,
    identity.built ? `Last updated: ${identity.built.slice(0, 10)}` : undefined,
    `Uptime: ${formatUptime(now - startedAt)}`,
    ratesDate() ? `Exchange rates: ${ratesDate()}` : undefined,
  ].filter((line): line is string => Boolean(line));
}

/** Reports the running revision, its build date and how long this process has been up. */
export async function handleVersionCommand(
  interaction: ChatInputCommandInteraction,
  startedAt = Date.now() - process.uptime() * 1_000,
  now = Date.now(),
): Promise<void> {
  await interaction.reply({ content: versionLines(startedAt, now).join("\n"), flags: MessageFlags.Ephemeral });
}

/** Pocket set prefixes, including promo ids, distinguish Pocket cards from physical-card ids. */
const POCKET_ID = /^(?:[ab]\d+[a-z]?|p[ab]?-[ab]?|p[ab])-/i;

/** Include Pocket attribution when any listed printing uses a Pocket id. */
function footerFor(printings: { id: string }[], attribution: string): string {
  const pocket = printings.some((printing) => POCKET_ID.test(printing.id));
  const physical = printings.some((printing) => !POCKET_ID.test(printing.id));
  if (pocket && physical) return `${attribution} · Pocket cards from pokemon-tcg-pocket-cards · github.com/PocketDecks/pokemon-tcg-pocket-cards`;
  return pocket ? POCKET_ATTRIBUTION : attribution;
}

export async function handlePrintingsCommand(
  context: CommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const query = interaction.options.getString("name", true).trim();
  await interaction.deferReply();
  const admission = admitRequest(context, interaction.guildId, interaction.user.id);
  if (!admission.allowed) {
    await interaction.editReply({ content: busyMessage(admission.retryAfterSeconds) });
    return;
  }
  const allowed = gamePreference(context, interaction.guildId)?.allowed ?? "both";

  // Autocomplete values are card ids; use the resolved name for the listing.
  let printings: Awaited<ReturnType<typeof printingsOf>>;
  try {
    const pinned = isCardId(query) ? await lookupById(context.client, query, { attribution: context.attribution }) : undefined;
    printings = await printingsOf(context.client, pinned?.card.name ?? query, allowed);
  } catch (error) {
    const hint = overloadHint(error);
    if (hint === undefined) throw error;
    await interaction.editReply({ content: busyMessage(hint) });
    return;
  }
  if (printings.length === 0) {
    await interaction.editReply({ content: `No card matched \`${query}\`.` });
    return;
  }

  const page: ListPage = {
    title: `${printings.length} ${printings.length === 1 ? "printing" : "printings"} of ${printings[0]!.name}`,
    items: printingItems(printings),
    perPage: 10,
    ownerId: interaction.user.id,
    // Credit Pocket when it appears alongside physical printings.
    footer: footerFor(printings, context.attribution),
  };
  const token = context.pages.put(page);
  await interaction.editReply(listReply(page, token, 0));
}
