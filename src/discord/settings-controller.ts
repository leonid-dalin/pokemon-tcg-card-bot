import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { createHash } from "node:crypto";
import { errorCategory } from "../diagnostics.js";
import type { GuildSettings, SettingsStore } from "../settings-store.js";
import { renderPanel, type PanelModel } from "./settings-panel.js";
import { SCOPE_PERSONAL, SCOPE_SERVER } from "./settings-panel.js";
import { SettingsSessions, type SettingsSession } from "./settings-session.js";

export interface SettingsPanelContext {
  settings: SettingsStore;
  mentionEnabled: boolean;
  sessions: SettingsSessions;
}

const FAILURE = "The settings panel could not be opened. Try /settings again.";

function baselineOf(settings: GuildSettings): string {
  const fields = [
    settings.messageReplies,
    settings.decklistReplies,
    settings.autoReplyChannelMode,
    [...settings.selectedChannelIds].sort().join(","),
    settings.cooldownSeconds,
    settings.cardGames,
    settings.defaultCardGame,
    settings.currency,
  ];
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0, 16);
}

function headingFor(session: SettingsSession, scope: "personal" | "server"): string {
  if (session.screen === "personal" || scope === "personal") return "For me";
  const where = session.guildId ? "Your server" : "This server";
  return session.screen === "overview" ? where : `${screenTitle(session.screen)} · ${where}`;
}

function screenTitle(screen: SettingsSession["screen"]): string {
  return { overview: "Overview", replies: "Replies", channels: "Channels", games: "Card games", currency: "Currency", personal: "For me" }[screen];
}

function rowsFor(
  session: SettingsSession,
  server: GuildSettings | undefined,
  mentionEnabled: boolean,
  personal?: { replies?: boolean; currency?: string },
): PanelModel["rows"] {
  if (session.scope === "personal" || session.screen === "personal" || !server) {
    return [
      { label: "Automatic replies", value: personal?.replies === undefined ? "Following each server" : personal.replies ? "On" : "Off" },
      { label: "Price currency", value: personal?.currency ?? "Following each server" },
    ];
  }
  const channels = server.autoReplyChannelMode === "all"
    ? "Every channel"
    : server.selectedChannelIds.length
      ? `${server.selectedChannelIds.length} selected`
      : "None selected, so automatic replies are off everywhere";
  const games = server.cardGames === "both"
    ? `Both · ${server.defaultCardGame === "ptcg" ? "physical" : "Pocket"} preferred`
    : server.cardGames === "ptcg" ? "Physical game" : "Pocket";
  return [
    { label: "Message replies", value: onOff(server.messageReplies, mentionEnabled) },
    { label: "Decklist replies", value: onOff(server.decklistReplies, true) },
    { label: "Channels", value: channels },
    { label: "Reply cooldown", value: server.cooldownSeconds === 0 ? "Off" : `${server.cooldownSeconds}s` },
    { label: "Card games", value: games },
    { label: "Server currency", value: server.currency ?? "EUR" },
  ];
}

function onOff(value: boolean, enabled = true): string {
  if (!enabled) return "Off · disabled by the host";
  return value ? "On" : "Off";
}

export class SettingsPanelController {
  constructor(
    private readonly store: SettingsStore,
    private readonly mentionEnabled: boolean,
    private readonly sessions: SettingsSessions,
    private readonly announce?: (guildId: string, channelId: string, lines: string[]) => Promise<void>,
  ) {}

  /** Opens the panel for a slash invocation: private, no channel message. */
  async openForCommand(interaction: ChatInputCommandInteraction, migrationNotice?: string): Promise<void> {
    const guildId = interaction.guildId;
    const isAdmin = interaction.inGuild() && Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
    const scope: "personal" | "server" = guildId && isAdmin ? "server" : "personal";
    const screen: SettingsSession["screen"] = guildId && isAdmin ? "overview" : "personal";
    const server = guildId ? this.store.get(guildId) : undefined;
    const session = this.sessions.open(interaction.user.id, guildId, scope, screen, baselineOf(server ?? ({} as GuildSettings)));
    await interaction.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [renderPanel(this.model(session, server, isAdmin, migrationNotice))],
      flags_: undefined,
    } as never).catch(async () => {
      await interaction.reply({ content: FAILURE, flags: MessageFlags.Ephemeral }).catch(() => {});
    });
  }

  private model(session: SettingsSession, server: GuildSettings | undefined, isAdmin: boolean, notice?: string, savedNotice?: string): PanelModel {
    const scope = session.scope;
    const personal = {
      replies: this.store.messageRepliesFor?.(session.ownerId),
      currency: this.store.currencyFor?.(session.ownerId) ?? undefined,
    };
    return {
      session,
      server,
      mentionEnabled: this.mentionEnabled,
      isAdmin,
      heading: headingFor(session, scope),
      rows: rowsFor(session, scope === "server" ? server : undefined, this.mentionEnabled, scope === "server" ? undefined : personal),
      notice,
      savedNotice,
    };
  }

  private async render(session: SettingsSession, interaction: ButtonInteraction | StringSelectMenuInteraction, isAdmin: boolean, notice?: string, savedNotice?: string): Promise<void> {
    const server = session.guildId ? this.store.get(session.guildId) : undefined;
    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [renderPanel(this.model(session, server, isAdmin, notice, savedNotice))],
    } as never);
  }

  /**
   * Opens a private panel for whoever presses a public launcher button.
   * The launcher carries no session or personal state.
   */
  async openFromLauncher(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const isAdmin = Boolean(interaction.inGuild() && interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
    const scope: "personal" | "server" = guildId && isAdmin ? "server" : "personal";
    const screen: SettingsSession["screen"] = guildId && isAdmin ? "overview" : "personal";
    const server = guildId ? this.store.get(guildId) : undefined;
    const session = this.sessions.open(interaction.user.id, guildId, scope, screen, baselineOf(server ?? ({} as GuildSettings)));
    await interaction.reply({
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      components: [renderPanel(this.model(session, server, isAdmin))],
    } as never).catch(async () => {
      await interaction.reply({ content: FAILURE, flags: MessageFlags.Ephemeral }).catch(() => {});
    });
  }

  /** Routes one st:* component interaction. */
  async handleComponent(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
    const customId = interaction.customId;
    const [namespace, action, argument] = customId.split(":");
    if (namespace !== "st") return;
    const ownerId = interaction.user.id;

    const sessionId = customId.split(":").slice(-1)[0] ?? "";
    const session = this.sessions.resolve(sessionId, ownerId);
    if (!session) {
      await interaction.reply({ content: "This panel has expired. Run /settings to open a new one.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    const isAdmin = Boolean(interaction.inGuild() && interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));

    if (action === "launcher") {
      await this.openFromLauncher(interaction as ButtonInteraction);
      return;
    }

    if (action === "reset" && argument === "confirm") {
      await this.handleResetConfirm(interaction, isAdmin);
      return;
    }

    if (customId.startsWith(`${SCOPE_PERSONAL}:`)) session.scope = "personal";
    else if (customId.startsWith(`${SCOPE_SERVER}:`)) session.scope = "server";

    try {
      switch (action) {
        case "refresh":
          this.sessions.update(session);
          await this.render(session, interaction, isAdmin);
          return;
        case "close":
          this.sessions.close(session.id);
          await interaction.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("Panel closed. Run /settings to reopen."))], flags: MessageFlags.IsComponentsV2 } as never);
          return;
        case "nav": {
          const select = interaction as StringSelectMenuInteraction;
          const value = select.values[0] as SettingsSession["screen"];
          session.screen = value;
          if (value === "channels") session.draftChannelIds = this.store.get(session.guildId ?? "").selectedChannelIds;
          this.sessions.update(session);
          await this.render(session, select, isAdmin);
          return;
        }
        case "scope": {
          const target = customId.startsWith(`${SCOPE_PERSONAL}:`) ? "personal" : "server";
          session.scope = target;
          session.screen = target === "personal" ? "personal" : "overview";
          this.sessions.update(session);
          await this.render(session, interaction as ButtonInteraction, isAdmin);
          return;
        }
        case "my": {
          const select = interaction as StringSelectMenuInteraction;
          const [kind, choice] = [customId.split(":")[2], select.values[0]];
          if (kind === "mentions") {
            if (choice === "default") this.store.clearMessageReplies(ownerId);
            else this.store.setMessageReplies(ownerId, choice === "on");
          } else if (kind === "currency") {
            if (choice === "default") this.store.clearCurrency(ownerId);
            else this.store.setCurrency(ownerId, choice as never);
          }
          this.sessions.update(session);
          await this.render(session, interaction, isAdmin, undefined, "Saved: your preference is updated. It applies everywhere you use the bot.");
          return;
        }
        case "set":
          await this.applyServerChange(interaction, session, isAdmin, customId);
          return;
        case "ch":
          await this.applyChannelMode(interaction, session, isAdmin, customId.split(":")[2] ?? "");
          return;
        case "reset":
          await this.renderResetConfirmation(interaction, session, isAdmin);
          return;
        default:
          await this.render(session, interaction, isAdmin);
      }
    } catch (error) {
      console.error(`settings panel interaction failed (${errorCategory(error)})`);
      await interaction.reply({ content: "That change could not be applied. Try again from /settings.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }

  private async renderResetConfirmation(interaction: ButtonInteraction | StringSelectMenuInteraction, session: SettingsSession, isAdmin: boolean): Promise<void> {
    this.sessions.update(session);
    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        new ContainerBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent("**Reset server settings?**\nThis restores the deployment defaults for every server switch, channels, cooldown, games and currency. Personal preferences are kept."))
          .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`st:reset:confirm:${session.id}`).setLabel("Confirm reset").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`st:refresh:${session.id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
          )),
      ],
    } as never);
  }

  private async handleResetConfirm(interaction: ButtonInteraction | StringSelectMenuInteraction, isAdmin: boolean): Promise<void> {
    const sessionId = interaction.customId.split(":")[3] ?? "";
    const session = this.sessions.resolve(sessionId, interaction.user.id);
    if (!session || !session.guildId) {
      await interaction.reply({ content: "This panel has expired. Run /settings to open a new one.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    if (!isAdminNow(interaction)) {
      await interaction.reply({ content: "Only members with the Manage Server permission can reset server settings.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    const before = this.store.get(session.guildId);
    this.store.delete(session.guildId);
    const after = this.store.get(session.guildId);
    this.sessions.update(session);
    await this.announceChange(interaction, [
      "Server settings were reset to the deployment defaults.",
      ...resetLines(before, after),
    ]);
    await this.render(session, interaction, isAdmin, "Server settings were reset.");
  }

  private async applyServerChange(interaction: ButtonInteraction | StringSelectMenuInteraction, session: SettingsSession, isAdmin: boolean, customId: string): Promise<void> {
    const [, , rawField, value] = customId.split(":");
    if (!rawField) return;
    const field: string = rawField;
    if (!session.guildId) return;
    if (!isAdmin) {
      await interaction.reply({ content: "Only members with the Manage Server permission can change server settings.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    const before = this.store.get(session.guildId);
    if (baselineOf(before) !== session.baseline) {
      session.baseline = baselineOf(before);
      this.sessions.update(session);
      await this.render(session, interaction, isAdmin, "These settings changed while you were here. This screen shows the current values; make your choice again.");
      return;
    }
    const patch: Partial<GuildSettings> =
      field === "messages" ? { messageReplies: value === "on" } :
      field === "decklists" ? { decklistReplies: value === "on" } :
      field === "currency" ? { currency: value as GuildSettings["currency"] } :
      {};
    if (Object.keys(patch).length === 0) return;
    const previous = describeField(before, field);
    this.store.update(session.guildId, patch);
    const after = this.store.get(session.guildId);
    const current = describeField(after, field);
    session.baseline = baselineOf(after);
    this.sessions.update(session);
    await this.render(session, interaction, isAdmin, undefined, `Saved: ${current}`);
    if (previous !== current) {
      await this.announceChange(interaction, [`${fieldName(field)}: ${previous} -> ${current}`]);
    }
  }

  private async applyChannelMode(interaction: ButtonInteraction | StringSelectMenuInteraction, session: SettingsSession, isAdmin: boolean, mode: string): Promise<void> {
    if (!session.guildId) return;
    if (!isAdmin) {
      await interaction.reply({ content: "Only members with the Manage Server permission can change server settings.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    if (mode !== "all" && mode !== "selected") return;
    const before = this.store.get(session.guildId);
    if (baselineOf(before) !== session.baseline) {
      session.baseline = baselineOf(before);
      this.sessions.update(session);
      await this.render(session, interaction, isAdmin, "These settings changed while you were here. Choose again.");
      return;
    }
    this.store.update(session.guildId, { autoReplyChannelMode: mode });
    const after = this.store.get(session.guildId);
    session.baseline = baselineOf(after);
    this.sessions.update(session);
    const previous = before.autoReplyChannelMode === "all" ? "Everywhere" : "Selected channels";
    const current = mode === "all" ? "Everywhere" : "Selected channels";
    await this.render(session, interaction, isAdmin, undefined, `Saved: replies are allowed ${current.toLowerCase()}.`);
    if (previous !== current) {
      await this.announceChange(interaction, [`Automatic-reply channels: ${previous} -> ${current}`]);
    }
  }

  private async announceChange(interaction: ButtonInteraction | StringSelectMenuInteraction, lines: string[]): Promise<void> {
    try {
      const channel = interaction.channel;
      if (channel && channel.isTextBased() && "send" in channel) {
        await channel.send({ embeds: [{ title: "Server settings changed", description: lines.join("\n") }] });
      }
    } catch (error) {
      console.error(`settings announcement failed (${errorCategory(error)})`);
    }
  }
}

function isAdminNow(interaction: ButtonInteraction | StringSelectMenuInteraction): boolean {
  return Boolean(interaction.inGuild() && interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

function describeField(settings: GuildSettings, field: string): string {
  switch (field) {
    case "messages": return settings.messageReplies ? "On" : "Off";
    case "decklists": return settings.decklistReplies ? "On" : "Off";
    case "currency": return settings.currency ?? "EUR";
    default: return "unknown";
  }
}

function fieldName(field: string): string {
  return { messages: "Message replies", decklists: "Decklist replies", currency: "Server default currency" }[field] ?? field;
}

function resetLines(before: GuildSettings, after: GuildSettings): string[] {
  const lines: string[] = [];
  if (before.messageReplies !== after.messageReplies) lines.push(`Message replies: ${before.messageReplies ? "On" : "Off"} -> ${after.messageReplies ? "On" : "Off"}`);
  if (before.decklistReplies !== after.decklistReplies) lines.push(`Decklist replies: ${before.decklistReplies ? "On" : "Off"} -> ${after.decklistReplies ? "On" : "Off"}`);
  if (before.cooldownSeconds !== after.cooldownSeconds) lines.push(`Reply cooldown: ${before.cooldownSeconds}s -> ${after.cooldownSeconds}s`);
  if (before.cardGames !== after.cardGames) lines.push(`Card games: ${before.cardGames} -> ${after.cardGames}`);
  if (before.currency !== after.currency) lines.push(`Server currency: ${before.currency ?? "EUR"} -> ${after.currency ?? "EUR"}`);
  return lines.length > 0 ? lines : ["No server field differed from the deployment defaults."];
}

// The scope-switch prefixes are part of the custom-id grammar.
const SCOPE_PREFIX = /^s[vp]:/;
