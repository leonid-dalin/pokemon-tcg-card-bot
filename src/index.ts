import { Client, Events } from "discord.js";
import { TcgdexClient } from "./api/tcgdex.js";
import { loadConfig } from "./config.js";
import { loadDotEnv } from "./env.js";
import {
  handleAutocomplete,
  handleCardCommand,
  handleDetailsButton,
  handleFilterMenu,
  handleHelpCommand,
  handleOpenCardMenu,
  handlePageButton,
  handlePrintingButton,
  handlePrintingsCommand,
  handleSearchCommand,
  handleSetCommand,
  type CommandContext,
} from "./discord/commands.js";
import { clientOptions } from "./discord/client-options.js";
import { PageStore } from "./discord/pages.js";
import { createMessageHandler } from "./discord/messages.js";
import { errorCategory } from "./diagnostics.js";
import { InvocationLog } from "./invocation-log.js";
import { SettingsStore } from "./settings-store.js";
import { MentionBudget } from "./cooldown.js";
import { join } from "node:path";
import { acquireSingleInstanceLock } from "./single-instance.js";
import { reportInteractionFailure } from "./discord/interaction-failure.js";
import { handleSettingsCommand } from "./discord/settings-command.js";
import { startRuntimeStatus } from "./runtime-status.js";

loadDotEnv();

if (!acquireSingleInstanceLock()) process.exit(1);

const config = loadConfig(process.env);
const invocations = new InvocationLog(config.invocationLogDir, config.invocationLogRetentionDays);
const settings = new SettingsStore(
  config.dataDir ? join(config.dataDir, "settings.db") : undefined,
  { messageReplies: config.mentionEnabled, decklistReplies: config.decklistEnabled, cooldownSeconds: config.mentionCooldownSeconds },
);
const api = new TcgdexClient();
const context: CommandContext = { client: api, attribution: config.attribution, energyEmoji: config.energyEmoji, pages: new PageStore(), settings };

const client = new Client(clientOptions(config));
startRuntimeStatus(() => client.isReady());
const budget =
  config.mentionCooldownSeconds > 0
    ? new MentionBudget({ refillSeconds: config.mentionCooldownSeconds })
    : undefined;

client.once(Events.ClientReady, (ready) => {
  invocations.prune();
  setInterval(() => invocations.prune(), 3_600_000).unref();
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
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("filter:")) {
      await handleFilterMenu(context, interaction);
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "card") {
      await handleCardCommand(context, interaction);
    } else if (interaction.commandName === "set") {
      await handleSetCommand(context, interaction);
    } else if (interaction.commandName === "search") {
      await handleSearchCommand(context, interaction);
    } else if (interaction.commandName === "printings") {
      await handlePrintingsCommand(context, interaction);
    } else if (interaction.commandName === "help") {
      await handleHelpCommand(interaction);
    } else if (interaction.commandName === "settings") {
      await handleSettingsCommand({ settings, mentionEnabled: config.mentionEnabled }, interaction);
    }
  } catch (error) {
    console.error(`interaction failed (${errorCategory(error)})`);
    await reportInteractionFailure(interaction).catch(() => {});
  }
});

client.on(
  Events.MessageCreate,
  createMessageHandler({ api, config, budget, invocations, settings, pages: context.pages, selfId: () => client.user?.id }),
);

client.on(Events.GuildDelete, (guild) => {
  try {
    settings.delete(guild.id);
  } catch (error) {
    console.error(`settings removal failed (${errorCategory(error)})`);
  }
});

process.on("unhandledRejection", (error) => console.error(`unhandled rejection (${errorCategory(error)})`));

await client.login(config.token);
