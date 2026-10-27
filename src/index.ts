import { Client, Events, GatewayIntentBits } from "discord.js";
import { TcgdexClient } from "./api/tcgdex.js";
import { loadConfig } from "./config.js";
import { loadDotEnv } from "./env.js";
import {
  handleAutocomplete,
  handleCardCommand,
  handleSearchCommand,
  handleSetCommand,
  type CommandContext,
} from "./discord/commands.js";
import { printingIdFrom, printingRows } from "./discord/printing-buttons.js";
import { parseDecklist } from "./decklist.js";
import { renderDecklist, renderSearchResults } from "./render.js";
import { searchCardText } from "./text-search.js";
import { toEmbeds } from "./discord/embeds.js";
import type { CardSummary } from "./api/types.js";
import { lookupById, lookupCard, lookupEmbeds, suggestNames } from "./lookup.js";
import { extractMentions, parseSearchCommand } from "./mentions.js";
import { MentionBudget } from "./cooldown.js";
import { acquireSingleInstanceLock } from "./single-instance.js";
import { reportInteractionFailure } from "./discord/interaction-failure.js";

const MAX_EMBEDS_PER_MESSAGE = 5;

loadDotEnv();

if (!acquireSingleInstanceLock()) process.exit(1);

const config = loadConfig(process.env);
const api = new TcgdexClient();
const context: CommandContext = { client: api, attribution: config.attribution };

const intents = [GatewayIntentBits.Guilds];
if (config.mentionEnabled) {
  intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
}

const client = new Client({ intents });
const budget =
  config.mentionCooldownSeconds > 0
    ? new MentionBudget({ refillSeconds: config.mentionCooldownSeconds })
    : undefined;
let warnedAboutContent = false;

client.once(Events.ClientReady, (ready) => {
  console.log(`logged in as ${ready.user.tag}; mention replies ${config.mentionEnabled ? "on" : "off"}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(context, interaction);
      return;
    }
    if (interaction.isButton()) {
      const id = printingIdFrom(interaction.customId);
      if (!id) return;
      await interaction.deferUpdate();
      const lookup = await lookupById(api, id, { attribution: config.attribution });
      if (!lookup) {
        await interaction.followUp({ content: `No card matched \`${id}\`.`, ephemeral: true });
        return;
      }
      await interaction.editReply({
        embeds: toEmbeds(lookupEmbeds(lookup)),
        components: printingRows(lookup.alternates),
      });
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "card") {
      await handleCardCommand(context, interaction);
    } else if (interaction.commandName === "set") {
      await handleSetCommand(context, interaction);
    } else if (interaction.commandName === "search") {
      await handleSearchCommand(context, interaction);
    }
  } catch (error) {
    console.error("interaction failed", error);
    await reportInteractionFailure(interaction).catch(() => {});
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!config.mentionEnabled) return;
  if (message.author.bot || message.webhookId) return;

  if (message.system) return;

  // With the Message Content intent switched off Discord still delivers the
  // event but strips the text, which looks like the bot ignoring everyone.
  // Attachments, embeds and stickers are legitimately text-free, so they are
  // not evidence of a missing intent.
  if (!message.content) {
    const hasRichContent =
      message.attachments.size > 0 || message.embeds.length > 0 || message.stickers.size > 0;
    if (!hasRichContent && !warnedAboutContent) {
      warnedAboutContent = true;
      console.warn(
        "received a message with no content: enable Message Content under Bot -> Privileged Gateway Intents, then restart",
      );
    }
    return;
  }

  const deck = config.decklistEnabled ? parseDecklist(message.content) : undefined;
  if (deck) {
    await message
      .reply({ embeds: toEmbeds([renderDecklist(deck)]), allowedMentions: { repliedUser: false } })
      .catch(() => {});
    return;
  }

  // Slash commands need the command picker, which is awkward on a phone. A
  // mention plus the word search does the same job from the message box.
  const selfId = client.user?.id;
  const searchQuery = selfId ? parseSearchCommand(message.content, selfId) : undefined;
  if (searchQuery !== undefined) {
    if (searchQuery.length === 0) {
      await message
        .reply({ content: "Add what to look for after search, for example: search stadium.", allowedMentions: { repliedUser: false } })
        .catch(() => {});
      return;
    }
    try {
      const cards = searchCardText(searchQuery);
      await message
        .reply({
          ...(cards.length === 0
            ? { content: `No card wording mentions \`${searchQuery}\`.` }
            : { embeds: toEmbeds([renderSearchResults(searchQuery, cards)]) }),
          allowedMentions: { repliedUser: false },
        })
        .catch(() => {});
    } catch (error) {
      console.error("mention search failed", error);
      await message
        .reply({ content: "Card search failed, try again in a moment.", allowedMentions: { repliedUser: false } })
        .catch(() => {});
    }
    return;
  }

  const mentions = extractMentions(message.content);
  if (mentions.length === 0) return;

  // Keyed per member, not per channel: a channel-wide budget lets one person's
  // mention swallow everyone else's.
  if (budget) {
    const verdict = budget.take(`${message.channelId}:${message.author.id}`);
    if (!verdict.allowed) {
      console.log(
        `skipped [[${mentions[0]?.raw ?? ""}]] from ${message.author.username}: ${verdict.retryAfterSeconds}s until the next one`,
      );
      return;
    }
  }

  try {
    const embeds = [];
    const misses: string[] = [];
    const suggestions = new Map<string, string>();
    const buttonCards: CardSummary[] = [];
    for (const mention of mentions) {
      const lookup = await lookupCard(api, mention.name, mention.setHint, {
        attribution: config.attribution,
      });
      console.log(`mention [[${mention.raw}]] -> ${lookup ? lookup.card.id : "no match"}`);
      if (lookup) {
        embeds.push(...toEmbeds(lookupEmbeds(lookup)));
        buttonCards.push(...lookup.alternates);
      } else {
        misses.push(mention.raw);
        const closest = await suggestNames(api, mention.name);
        if (closest.length > 0) {
          suggestions.set(
            mention.raw,
            closest.map((card) => `\`${card.name}\` (${card.id})`).join(", "),
          );
        }
      }
      if (embeds.length >= MAX_EMBEDS_PER_MESSAGE) break;
    }
    if (embeds.length === 0 && misses.length === 0) return;

    // A mention is an explicit request, so a name that resolves to nothing gets
    // an answer. Silence here reads as a broken bot, not as a polite no-op.
    await message.reply({
      ...(embeds.length > 0 ? { components: printingRows(buttonCards) } : {}),
      ...(misses.length > 0
        ? {
            content: misses
              .map((raw) => {
                const closest = suggestions.get(raw);
                const base = `No card matched \`${raw}\`.`;
                return closest ? `${base} Closest: ${closest}.` : base;
              })
              .join("\n"),
          }
        : {}),
      ...(embeds.length > 0 ? { embeds: embeds.slice(0, MAX_EMBEDS_PER_MESSAGE) } : {}),
      allowedMentions: { repliedUser: false },
    });
  } catch (error) {
    console.error("mention lookup failed", error);
    // A dead API used to leave the channel with nothing at all.
    await message
      .reply({ content: "Card lookup failed, try again in a moment.", allowedMentions: { repliedUser: false } })
      .catch(() => {});
  }
});

process.on("unhandledRejection", (error) => console.error("unhandled rejection", error));

await client.login(config.token);
