import { Client, Events, MessageFlags } from "discord.js";
import { TcgdexClient } from "./api/tcgdex.js";
import { loadConfig } from "./config.js";
import { loadDotEnv } from "./env.js";
import {
  handleAutocomplete,
  handleCardCommand,
  handleDetailsButton,
  handleFilterMenu,
  handleHelpCommand,
  handleVersionCommand,
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
import { createShardReadiness } from "./discord/shard-readiness.js";
import { EmbedBuilder } from "discord.js";
import { settingsAnnouncementChunks } from "./discord/announcement.js";
import { SettingsPanelController } from "./discord/settings-controller.js";
import { handleVersionAction } from "./discord/commands.js";
import { SettingsSessions } from "./discord/settings-session.js";
import { CleanupWorker } from "./discord/cleanup-worker.js";
import { startRuntimeStatus } from "./runtime-status.js";

loadDotEnv();

if (!acquireSingleInstanceLock()) process.exit(1);

const config = loadConfig(process.env);
const invocations = new InvocationLog(config.invocationLogDir, config.invocationLogRetentionDays);
const settings = new SettingsStore(
  config.dataDir ? join(config.dataDir, "settings.db") : undefined,
  { messageReplies: config.mentionEnabled, decklistReplies: config.decklistEnabled, cooldownSeconds: config.mentionCooldownSeconds },
);
const api = new TcgdexClient({
  limiter: {
    concurrency: config.upstreamConcurrency,
    queueLimit: config.upstreamQueueLimit,
    queueWaitMs: config.upstreamQueueWaitMs,
  },
});
const memberBudget = new MentionBudget({
  capacity: config.memberLookupBurst,
  refillSeconds: config.memberLookupRefillSeconds,
  maxKeys: 10_000,
});
// Autocomplete fires on each keystroke, so it gets a wider but separate allowance.
const typingBudget = new MentionBudget({ capacity: 40, refillSeconds: 2, maxKeys: 10_000 });
const context: CommandContext = {
  client: api,
  attribution: config.attribution,
  energyEmoji: config.energyEmoji,
  pages: new PageStore(),
  settings,
  requests: memberBudget,
  typing: typingBudget,
};

/** The permanent record a server settings change leaves in the channel that made it. */
function settingsAnnouncement(description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Server settings changed")
    .setDescription(description)
    .setColor(0x4f9cff);
}

const settingsSessions = new SettingsSessions();
const settingsPanel = new SettingsPanelController(
  settings,
  config.mentionEnabled,
  settingsSessions,
  async (guildId, channelId, lines) => {
    const channel = await client.channels.fetch(channelId).catch((error: unknown) => {
      console.error(`settings announcement could not reach ${guildId}/${channelId} (${errorCategory(error)})`);
      return undefined;
    });
    if (!channel || !channel.isTextBased() || channel.isDMBased()) return;
    for (const description of settingsAnnouncementChunks(lines)) {
      try {
        await channel.send({ embeds: [settingsAnnouncement(description)] });
      } catch (error) {
        console.error(`settings announcement failed in ${guildId}/${channelId} (${errorCategory(error)})`);
        return;
      }
    }
  },
);

const client = new Client(clientOptions(config));
const cleanupWorker = new CleanupWorker(client, settings);
startRuntimeStatus(createShardReadiness(client));
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
  const kind = interaction.isButton()
    ? "button"
    : interaction.isStringSelectMenu()
      ? "select"
      : interaction.isModalSubmit()
        ? "modal"
        : interaction.isChatInputCommand()
          ? "command"
          : "other";
  const label = "customId" in interaction ? interaction.customId : interaction.commandName;
  console.log(`interaction ${kind} ${label} received (${interaction.id})`);
  let handled = false;
  try {
    if (interaction.isAutocomplete()) {
      handled = true;
      await handleAutocomplete(context, interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("v:")) {
      handled = true;
      await handleVersionAction(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === "st:launcher") {
      handled = true;
      await settingsPanel.openFromLauncher(interaction as never);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("st:")) {
      handled = true;
      await settingsPanel.handleComponent(interaction as never);
      return;
    }
    if (
      (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) &&
      interaction.customId.startsWith("st:")
    ) {
      handled = true;
      await settingsPanel.handleComponent(interaction as never);
      return;
    }
    if (interaction.isButton()) {
      handled = true;
      if (interaction.customId.startsWith("iset:")) {
        await interaction.reply({ content: "The settings toggles moved into the settings panel. Run /settings to open it.", flags: MessageFlags.Ephemeral }).catch(() => {});
      } else if (interaction.customId.startsWith("details:")) {
        await handleDetailsButton(context, interaction);
      } else if (interaction.customId.startsWith("page:")) {
        await handlePageButton(context, interaction);
      } else {
        await handlePrintingButton(context, interaction);
      }
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("open:")) {
      handled = true;
      await handleOpenCardMenu(context, interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("filter:")) {
      handled = true;
      await handleFilterMenu(context, interaction);
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    handled = true;
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
    } else if (interaction.commandName === "version") {
      await handleVersionCommand(interaction);
    } else if (interaction.commandName === "settings") {
      const stale = interaction.options.getSubcommand(false) !== null;
      await settingsPanel.openForCommand(interaction as never, stale);
    }
  } catch (error) {
    console.error(`interaction failed (${errorCategory(error)}): ${error instanceof Error ? error.message : String(error)}`);
    await reportInteractionFailure(interaction, error).catch(() => {});
  } finally {
    console.log(`interaction ${kind} ${label} ${handled ? "handled" : "unhandled"}`);
  }
});

client.on(
  Events.MessageCreate,
  createMessageHandler({ api, config, budget, requests: memberBudget, invocations, settings, pages: context.pages, cleanup: cleanupWorker, selfId: () => client.user?.id }),
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
cleanupWorker.start();
