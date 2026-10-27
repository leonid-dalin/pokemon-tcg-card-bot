import { Client, Events, GatewayIntentBits } from "discord.js";
import { TcgdexClient } from "./api/tcgdex.js";
import { loadConfig } from "./config.js";
import { loadDotEnv } from "./env.js";
import {
  handleAutocomplete,
  handleCardCommand,
  handleSetCommand,
  type CommandContext,
} from "./discord/commands.js";
import { toEmbeds } from "./discord/embeds.js";
import { lookupCard, lookupEmbeds } from "./lookup.js";
import { extractMentions } from "./mentions.js";

const MAX_EMBEDS_PER_MESSAGE = 5;

loadDotEnv();

const config = loadConfig(process.env);
const api = new TcgdexClient();
const context: CommandContext = { client: api, attribution: config.attribution };

const intents = [GatewayIntentBits.Guilds];
if (config.mentionEnabled) {
  intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
}

const client = new Client({ intents });
const mentionCooldowns = new Map<string, number>();
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
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "card") {
      await handleCardCommand(context, interaction);
    } else if (interaction.commandName === "set") {
      await handleSetCommand(context, interaction);
    }
  } catch (error) {
    console.error("interaction failed", error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Card lookup failed, try again.", ephemeral: true }).catch(() => {});
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!config.mentionEnabled) return;
  if (message.author.bot || message.webhookId) return;

  // With the Message Content intent switched off Discord still delivers the
  // event but strips the text, which looks like the bot ignoring everyone.
  if (!message.content && !warnedAboutContent) {
    warnedAboutContent = true;
    console.warn(
      "received a message with no content: enable Message Content under Bot -> Privileged Gateway Intents, then restart",
    );
    return;
  }

  const mentions = extractMentions(message.content);
  if (mentions.length === 0) return;

  // Keyed per member, not per channel: a channel-wide budget lets one person's
  // mention swallow everyone else's for the rest of the window.
  const key = `${message.channelId}:${message.author.id}`;
  const now = Date.now();
  const until = mentionCooldowns.get(key) ?? 0;
  if (now < until) {
    console.log(
      `skipped [[${mentions[0]?.raw ?? ""}]] from ${message.author.username}: ${Math.ceil((until - now) / 1000)}s of cooldown left`,
    );
    return;
  }
  mentionCooldowns.set(key, now + config.mentionCooldownMs);

  try {
    const embeds = [];
    for (const mention of mentions) {
      const lookup = await lookupCard(api, mention.name, mention.setHint, {
        attribution: config.attribution,
      });
      console.log(`mention [[${mention.raw}]] -> ${lookup ? lookup.card.id : "no match"}`);
      if (lookup) embeds.push(...toEmbeds(lookupEmbeds(lookup)));
      if (embeds.length >= MAX_EMBEDS_PER_MESSAGE) break;
    }
    if (embeds.length === 0) return;
    await message.reply({
      embeds: embeds.slice(0, MAX_EMBEDS_PER_MESSAGE),
      allowedMentions: { repliedUser: false },
    });
  } catch (error) {
    console.error("mention lookup failed", error);
  }
});

process.on("unhandledRejection", (error) => console.error("unhandled rejection", error));

await client.login(config.token);
