import { Client, Events } from "discord.js";
import { TcgdexClient } from "./api/tcgdex.js";
import { loadConfig } from "./config.js";
import { loadDotEnv } from "./env.js";
import {
  handleAutocomplete,
  handleCardCommand,
  handleDetailsButton,
  handleOpenCardMenu,
  handlePageButton,
  handlePrintingButton,
  handleSearchCommand,
  handleSetCommand,
  type CommandContext,
} from "./discord/commands.js";
import { clientOptions } from "./discord/client-options.js";
import { PageStore } from "./discord/pages.js";
import { createMessageHandler } from "./discord/messages.js";
import { MentionBudget } from "./cooldown.js";
import { acquireSingleInstanceLock } from "./single-instance.js";
import { reportInteractionFailure } from "./discord/interaction-failure.js";

loadDotEnv();

if (!acquireSingleInstanceLock()) process.exit(1);

const config = loadConfig(process.env);
const api = new TcgdexClient();
const context: CommandContext = { client: api, attribution: config.attribution, energyEmoji: config.energyEmoji, pages: new PageStore() };

const client = new Client(clientOptions(config));
const budget =
  config.mentionCooldownSeconds > 0
    ? new MentionBudget({ refillSeconds: config.mentionCooldownSeconds })
    : undefined;

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
      if (interaction.customId.startsWith("details:")) {
        await handleDetailsButton(context, interaction);
      } else if (interaction.customId.startsWith("page:")) {
        await handlePageButton(context, interaction);
      } else {
        await handlePrintingButton(context, interaction);
      }
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("open:")) {
      await handleOpenCardMenu(context, interaction);
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

client.on(
  Events.MessageCreate,
  createMessageHandler({ api, config, budget, selfId: () => client.user?.id }),
);

process.on("unhandledRejection", (error) => console.error("unhandled rejection", error));

await client.login(config.token);
