import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
} from "discord.js";
import { errorCategory } from "../diagnostics.js";
import type { Currency, GuildSettingsPatch, SettingsStore } from "../settings-store.js";

const CURRENCY_LABELS: Record<Currency, string> = {
  EUR: "euros (€)",
  USD: "US dollars ($)",
  GBP: "pounds (£)",
  JPY: "yen (¥)",
  CNY: "yuan (¥)",
};

export const settingsCommand = new SlashCommandBuilder()
  .setName("settings")
  .setDescription("Configure how the bot replies in this server")
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) => sub.setName("view").setDescription("Show the current settings"))
  .addSubcommand((sub) =>
    sub
      .setName("messages")
      .setDescription("Allow automatic replies to card mentions, searches and help requests")
      .addBooleanOption((option) => option.setName("enabled").setDescription("on or off").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("decklists")
      .setDescription("Allow replies to pasted deck lists")
      .addBooleanOption((option) => option.setName("enabled").setDescription("on or off").setRequired(true)),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("channels")
      .setDescription("Choose where automatic replies are allowed")
      .addSubcommand((sub) =>
        sub
          .setName("mode")
          .setDescription("Reply everywhere, or only in the channels you pick")
          .addStringOption((option) =>
            option
              .setName("mode")
              .setDescription("all channels, or only the selected ones")
              .addChoices({ name: "all channels", value: "all" }, { name: "only selected", value: "selected" })
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Allow automatic replies in a channel")
          .addChannelOption((option) =>
            option
              .setName("channel")
              .setDescription("the channel to allow")
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Stop automatic replies in a channel")
          .addChannelOption((option) =>
            option
              .setName("channel")
              .setDescription("the channel to stop")
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) => sub.setName("clear").setDescription("Clear the channel list; with only selected, replies stop everywhere")),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("games")
      .setDescription("Choose which card games lookups answer from")
      .addSubcommand((sub) =>
        sub
          .setName("allowed")
          .setDescription("Which games lookups may answer from")
          .addStringOption((option) =>
            option
              .setName("games")
              .setDescription("the physical game, Pocket, or both")
              .addChoices(
                { name: "physical game only", value: "ptcg" },
                { name: "Pocket only", value: "pocket" },
                { name: "both games", value: "both" },
              )
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("default")
          .setDescription("Which game wins when a name exists in both; needs both games allowed")
          .addStringOption((option) =>
            option
              .setName("game")
              .setDescription("the game preferred for ambiguous names")
              .addChoices({ name: "physical game", value: "ptcg" }, { name: "Pocket", value: "pocket" })
              .setRequired(true),
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("cooldown")
      .setDescription("Seconds a member waits between automatic replies; 0 turns the throttle off")
      .addIntegerOption((option) =>
        option.setName("seconds").setDescription("0 to 86400").setMinValue(0).setMaxValue(86_400).setRequired(true),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("currency")
      .setDescription("Prices for you, or the default this server starts from")
      .addSubcommand((sub) =>
        sub
          .setName("user")
          .setDescription("Your price currency; overrides this server's default")
          .addStringOption((option) =>
            option
              .setName("code")
              .setDescription("currency for your prices")
              .addChoices(
                { name: "Default (follow this server)", value: "default" },
                { name: "Euro (€)", value: "EUR" },
                { name: "US dollar ($)", value: "USD" },
                { name: "Pound (£)", value: "GBP" },
                { name: "Yen (¥)", value: "JPY" },
                { name: "Yuan (¥ RMB)", value: "CNY" },
              )
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("server")
          .setDescription("Default price currency for this server")
          .addStringOption((option) =>
            option
              .setName("code")
              .setDescription("currency for the server default")
              .addChoices(
                { name: "Euro (€)", value: "EUR" },
                { name: "US dollar ($)", value: "USD" },
                { name: "Pound (£)", value: "GBP" },
                { name: "Yen (¥)", value: "JPY" },
                { name: "Yuan (¥ RMB)", value: "CNY" },
              )
              .setRequired(true),
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("mentions")
      .setDescription("Your own automatic replies, overriding this server's switch")
      .addStringOption((option) =>
        option
          .setName("enabled")
          .setDescription("on, off, or follow this server")
          .addChoices(
            { name: "Follow this server", value: "default" },
            { name: "On", value: "on" },
            { name: "Off", value: "off" },
          )
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) => sub.setName("reset").setDescription("Back to the deployment defaults"));

export interface SettingsCommandContext {
  settings: SettingsStore;
  mentionEnabled: boolean;
}

function ephemeral(content: string): InteractionReplyOptions {
  return { content, flags: MessageFlags.Ephemeral };
}

export async function handleSettingsCommand(
  context: SettingsCommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply(ephemeral("Settings belong to a server. Run this in one where you manage it."));
    return;
  }
  const guildId = interaction.guildId;
  // Acknowledge before touching storage: the store may wait up to five seconds on a
  // lock, past Discord's three-second initial-response deadline.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const reply = async (content: string) => {
    await interaction.editReply({ content });
  };
  const apply = async (patch: GuildSettingsPatch, confirm: string) => {
    try {
      context.settings.update(guildId, patch);
    } catch (error) {
      await reply(`Could not save that change (${errorCategory(error)}). Nothing was changed.`);
      return;
    }
    // A delivery failure must not claim the committed change was rolled back.
    await reply(confirm).catch(() => {});
  };

  const group = interaction.options.getSubcommandGroup(false);
  const sub = group ? `${group}:${interaction.options.getSubcommand(true)}` : interaction.options.getSubcommand(true);

  // Personal preferences are open to every member; the rest need Manage Server.
  const personal = sub === "mentions" || sub === "currency:user";
  if (!personal && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply("Only members with the Manage Server permission can change these settings.");
    return;
  }

  if (sub === "view") {
    const settings = context.settings.get(guildId);
    const channels =
      settings.autoReplyChannelMode === "all"
        ? "every channel"
        : settings.selectedChannelIds.length
          ? settings.selectedChannelIds.length > 10
            ? `${settings.selectedChannelIds.slice(0, 10).map((id) => `<#${id}>`).join(", ")} and ${settings.selectedChannelIds.length - 10} more`
            : settings.selectedChannelIds.map((id) => `<#${id}>`).join(", ")
          : "none selected, so automatic replies are off everywhere";
    const games = settings.cardGames === "both" ? "both games" : settings.cardGames === "ptcg" ? "the physical game only" : "Pocket only";
    const preferred =
      settings.cardGames === "both"
        ? ` When a name exists in both, ${settings.defaultCardGame === "ptcg" ? "the physical card" : "the Pocket card"} wins.`
        : "";
    const lines = [
      `Message replies: ${settings.messageReplies ? "on" : "off"}`,
      `Decklist replies: ${settings.decklistReplies ? "on" : "off"}`,
      `Automatic-reply channels: ${channels}`,
      `Cooldown between replies per member: ${settings.cooldownSeconds === 0 ? "off" : `${settings.cooldownSeconds}s`}`,
      `Card games: ${games}.${preferred} A hint like [[name|pocket]] still forces its game.`,
    ];
    if (!context.mentionEnabled) {
      lines.push("This deployment has mention replies switched off, so nothing here turns them back on.");
    }
    await reply(lines.join("\n"));
    return;
  }

  if (sub === "messages") {
    const enabled = interaction.options.getBoolean("enabled", true);
    await apply({ messageReplies: enabled }, `Message replies are now ${enabled ? "on" : "off"}.`);
    return;
  }

  if (sub === "decklists") {
    const enabled = interaction.options.getBoolean("enabled", true);
    await apply({ decklistReplies: enabled }, `Decklist replies are now ${enabled ? "on" : "off"}.`);
    return;
  }

  if (sub === "channels:mode") {
    const mode = interaction.options.getString("mode", true) as "all" | "selected";
    await apply(
      { autoReplyChannelMode: mode },
      mode === "all"
        ? "Automatic replies are allowed in every channel."
        : "Automatic replies now happen only in the selected channels, and threads follow their parent channel.",
    );
    return;
  }

  if (sub === "channels:add") {
    const channelId = interaction.options.getChannel("channel", true).id;
    const existing = context.settings.get(guildId).selectedChannelIds;
    if (existing.includes(channelId)) {
      await reply(`<#${channelId}> is already selected.`);
      return;
    }
    await apply(
      { selectedChannelIds: [...existing, channelId] },
      `<#${channelId}> added. Switch the channel mode to "only selected" if it is not already.`,
    );
    return;
  }

  if (sub === "channels:remove") {
    const channelId = interaction.options.getChannel("channel", true).id;
    const existing = context.settings.get(guildId).selectedChannelIds;
    if (!existing.includes(channelId)) {
      await reply(`<#${channelId}> was not selected.`);
      return;
    }
    const remaining = existing.filter((id) => id !== channelId);
    const emptied = remaining.length === 0 && context.settings.get(guildId).autoReplyChannelMode === "selected";
    await apply(
      { selectedChannelIds: remaining },
      emptied
        ? `<#${channelId}> removed. The selected list is empty, so automatic replies are off everywhere.`
        : `<#${channelId}> removed.`,
    );
    return;
  }

  if (sub === "channels:clear") {
    await apply({ selectedChannelIds: [] }, "Channel list cleared. With the selected mode on, automatic replies are off everywhere.");
    return;
  }

  if (sub === "games:allowed") {
    const games = interaction.options.getString("games", true) as "ptcg" | "pocket" | "both";
    await apply(
      { cardGames: games },
      games === "both"
        ? "Lookups answer from both games. Use the default-game setting to pick which wins on a shared name."
        : games === "ptcg"
          ? "Lookups answer from the physical game only. A hint like [[name|pocket]] still forces Pocket."
          : "Lookups answer from Pocket only. A physical set hint still forces the physical game.",
    );
    return;
  }

  if (sub === "games:default") {
    const game = interaction.options.getString("game", true) as "ptcg" | "pocket";
    const current = context.settings.get(guildId);
    if (current.cardGames !== "both") {
      await reply("A default game only matters when both games are allowed. Set the allowed games to both first.");
      return;
    }
    await apply(
      { defaultCardGame: game },
      game === "ptcg"
        ? "Names that exist in both games now answer with the physical card."
        : "Names that exist in both games now answer with the Pocket card.",
    );
    return;
  }

  if (sub === "cooldown") {
    const seconds = interaction.options.getInteger("seconds", true);
    await apply(
      { cooldownSeconds: seconds },
      seconds === 0 ? "The per-member throttle is off." : `Members now wait ${seconds}s between automatic replies.`,
    );
    return;
  }

  if (sub === "mentions") {
    const choice = interaction.options.getString("enabled", true);
    if (choice === "default") {
      context.settings.clearMessageReplies(interaction.user.id);
      await reply("Your automatic replies follow this server again.");
      return;
    }
    context.settings.setMessageReplies(interaction.user.id, choice === "on");
    await reply(`Your automatic replies are now ${choice}.`);
    return;
  }

  if (sub === "currency:user") {
    const code = interaction.options.getString("code", true);
    if (code === "default") {
      context.settings.clearCurrency(interaction.user.id);
      await reply("Your prices now follow this server's currency.");
      return;
    }
    context.settings.setCurrency(interaction.user.id, code as Currency);
    await reply(`Your prices now show in ${CURRENCY_LABELS[code as Currency]}.`);
    return;
  }

  if (sub === "currency:server") {
    const code = interaction.options.getString("code", true) as Currency;
    await apply({ currency: code }, `This server's default currency is now ${CURRENCY_LABELS[code]}.`);
    return;
  }

  if (sub === "reset") {
    try {
      context.settings.delete(guildId);
    } catch (error) {
      await reply(`Could not reset the settings (${errorCategory(error)}). Nothing was changed.`);
      return;
    }
    await reply("Settings reset to the deployment defaults.").catch(() => {});
  }
}
