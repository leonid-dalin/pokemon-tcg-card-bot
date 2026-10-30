import { createHash } from "node:crypto";
import { errorCategory } from "../diagnostics.js";
import type { GuildSettings, SettingsStore } from "../settings-store.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  ModalBuilder,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { renderPanel, SCOPE_PERSONAL, SCOPE_SERVER } from "./settings-panel.js";
import { SettingsSessions, type SettingsSession } from "./settings-session.js";

export interface SettingsPanelContext {
  settings: SettingsStore;
  mentionEnabled: boolean;
  sessions: SettingsSessions;
}

/**
 * The narrow shape of every interaction the panel handles. Both Discord
 * component interactions and modal submissions satisfy it.
 */
export interface PanelInteraction {
  user: { id: string };
  guildId: string | null;
  channelId: string;
  customId: string;
  channel?: unknown;
  memberPermissions?: { has: (flag: bigint | string) => boolean } | null;
  inGuild?(): boolean;
  values?: string[];
  fields?: { getTextInputValue: (id: string) => string };
  update?(payload: unknown): Promise<unknown>;
  reply(payload: unknown): Promise<unknown>;
  editReply(payload: unknown): Promise<unknown>;
  followUp(payload: unknown): Promise<unknown>;
  deferUpdate(): Promise<unknown>;
  deferReply(options?: { flags?: number }): Promise<unknown>;
  showModal(modal: unknown): unknown;
}

function isAdminNow(interaction: PanelInteraction): boolean {
  return Boolean(interaction.inGuild?.() && interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

export function baselineOf(settings: GuildSettings | undefined): string {
  if (!settings) return "no-server";
  const fields = [
    settings.messageReplies,
    settings.decklistReplies,
    settings.autoReplyChannelMode,
    [...(settings.selectedChannelIds ?? [])].sort().join(","),
    settings.cooldownSeconds,
    settings.cardGames,
    settings.defaultCardGame,
    settings.currency,
  ];
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0, 16);
}

function headingFor(session: SettingsSession): string {
  if (session.screen === "personal" || session.scope === "personal") return "For me";
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
): { label: string; value: string }[] {
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

function describeField(settings: GuildSettings, field: string): string {
  switch (field) {
    case "messages": return settings.messageReplies ? "On" : "Off";
    case "decklists": return settings.decklistReplies ? "On" : "Off";
    case "currency": return settings.currency ?? "EUR";
    case "cooldown": return settings.cooldownSeconds === 0 ? "Off" : `${settings.cooldownSeconds}s`;
    case "games": return settings.cardGames;
    case "defaultgame": return settings.defaultCardGame;
    default: return "unknown";
  }
}

function fieldName(field: string): string {
  return { messages: "Message replies", decklists: "Decklist replies", currency: "Server default currency", cooldown: "Reply cooldown", games: "Card games", defaultgame: "Preferred game" }[field] ?? field;
}

function serverPatch(field: string, value: string): Partial<GuildSettings> | undefined {
  switch (field) {
    case "messages": return { messageReplies: value === "on" };
    case "decklists": return { decklistReplies: value === "on" };
    case "currency": return { currency: value as GuildSettings["currency"] };
    case "games": return { cardGames: value as GuildSettings["cardGames"] };
    case "defaultgame": return { defaultCardGame: value as GuildSettings["defaultCardGame"] };
    case "cooldown": {
      const seconds = Number(value);
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) return undefined;
      return { cooldownSeconds: seconds };
    }
    default: return undefined;
  }
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

export class SettingsPanelController {
  constructor(
    private readonly store: SettingsStore,
    private readonly mentionEnabled: boolean,
    private readonly sessions: SettingsSessions,
    private readonly announce?: (guildId: string, channelId: string, lines: string[]) => Promise<void>,
  ) {}

  /** Opens the panel for a slash invocation: private, no channel message. */
  async openForCommand(interaction: PanelInteraction, staleClient?: boolean): Promise<void> {
    await this.open(interaction, staleClient === true);
  }

  /** Opens a private panel for whoever presses a public launcher button. */
  async openFromLauncher(interaction: PanelInteraction): Promise<void> {
    await this.open(interaction, false);
  }

  private async open(interaction: PanelInteraction, staleClient: boolean): Promise<void> {
    const guildId = interaction.guildId;
    const isAdmin = Boolean(interaction.inGuild?.() && interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
    const scope: "personal" | "server" = guildId && isAdmin ? "server" : "personal";
    const screen: SettingsSession["screen"] = guildId && isAdmin ? "overview" : "personal";
    const server = guildId ? this.store.get(guildId) : undefined;
    const session = this.sessions.open(interaction.user.id, guildId, scope, screen, baselineOf(server));
    const model = this.model(session, server, isAdmin, staleClient ? "The /settings subcommands were replaced by this panel." : undefined);
    const payload = {
      flags: MessageFlags.IsComponentsV2,
      components: [renderPanel(model)],
    };
    try {
      // Deferring first keeps the panel a follow-up message: an initial ephemeral
      // response with the V2 flag is stored by Discord but renders blank on the client.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply(payload as never);
    } catch (error) {
      console.error(`settings panel reply failed (${errorCategory(error)})`);
      await interaction.followUp({ content: "The settings panel could not be opened. Try /settings again.", flags: MessageFlags.Ephemeral }).catch(() => {});
      throw error;
    }
  }

  private model(session: SettingsSession, server: GuildSettings | undefined, isAdmin: boolean, notice?: string, savedNotice?: string): PanelModelShape {
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
      heading: headingFor(session),
      rows: rowsFor(session, scope === "server" ? server : undefined, this.mentionEnabled, scope === "server" ? undefined : personal),
      notice,
      savedNotice,
    };
  }

  private async render(session: SettingsSession, interaction: PanelInteraction, isAdmin: boolean, notice?: string, savedNotice?: string): Promise<void> {
    const server = session.guildId ? this.store.get(session.guildId) : undefined;
    const components = [renderPanel(this.model(session, server, isAdmin, notice, savedNotice))];
    if (typeof interaction.update === "function") {
      await interaction.update({ flags: MessageFlags.IsComponentsV2, components } as never);
      return;
    }
    await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components } as never);
  }

  /** Acknowledges a component interaction with fresh components. */
  private async present(interaction: PanelInteraction, ...components: unknown[]): Promise<void> {
    const payload = { flags: MessageFlags.IsComponentsV2, components } as never;
    if (typeof interaction.update === "function") {
      await interaction.update(payload);
      return;
    }
    await interaction.editReply(payload);
  }

  /** Routes one st:* component or modal interaction. */
  async handleComponent(interaction: PanelInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const [namespace, action] = parts;
    if (namespace !== "st") return;
    const isAdmin = isAdminNow(interaction);

    if (action === "launcher") {
      await this.open(interaction, false);
      return;
    }

    if (action === "cooldown-modal") {
      await this.handleCooldownModal(interaction, isAdmin);
      return;
    }

    if (action === "reset" && parts[2] === "confirm") {
      await this.handleResetConfirm(interaction, isAdmin);
      return;
    }

    const sessionId = parts[parts.length - 1] ?? "";
    const session = this.sessions.resolve(sessionId, interaction.user.id);
    if (!session) {
      await interaction.reply({ content: "This panel has expired. Run /settings to open a new one.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    switch (action) {
      case "refresh":
        this.sessions.update(session);
        await this.render(session, interaction, isAdmin);
        return;
      case "close":
        this.sessions.close(session.id);
        await this.present(interaction, new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("Panel closed. Run /settings to reopen.")));
        return;
      case "nav": {
        const value = interaction.values?.[0] as SettingsSession["screen"] | undefined;
        if (!value) return;
        session.screen = value;
        if (value === "channels") session.draftChannelIds = session.guildId ? [...this.store.get(session.guildId).selectedChannelIds] : [];
        this.sessions.update(session);
        await this.render(session, interaction, isAdmin);
        return;
      }
      case "scope": {
        const target = parts[2];
        if (target === "server" && !isAdmin) {
          await this.render(session, interaction, isAdmin, "Only a member with Manage Server can open the server view.");
          return;
        }
        session.scope = target === "server" ? "server" : "personal";
        session.screen = session.scope === "server" ? "overview" : "personal";
        this.sessions.update(session);
        await this.render(session, interaction, isAdmin);
        return;
      }
      case "my": {
        const kind = parts[2];
        const choice = interaction.values?.[0] ?? "";
        if (kind === "mentions") {
          if (choice === "default") this.store.clearMessageReplies(interaction.user.id);
          else this.store.setMessageReplies(interaction.user.id, choice === "on");
        } else if (kind === "currency") {
          if (choice === "default") this.store.clearCurrency(interaction.user.id);
          else this.store.setCurrency(interaction.user.id, choice as never);
        }
        this.sessions.update(session);
        await this.render(session, interaction, isAdmin, undefined, "Saved: your preference is updated. It applies everywhere you use the bot.");
        return;
      }
      case "set": {
        const field = parts[2] ?? "";
        const value = interaction.values?.[0] ?? parts[3] ?? "";
        await this.applyServerField(interaction, session, isAdmin, field, value);
        return;
      }
      case "ch":
        await this.handleChannels(interaction, session, isAdmin, parts);
        return;
      case "cooldown-custom": {
        const modal = new ModalBuilder()
          .setCustomId(`st:cooldown-modal:${session.id}`)
          .setTitle("Custom reply cooldown")
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("seconds")
                .setLabel("Seconds between replies (0 to 86400)")
                .setStyle(TextInputStyle.Short)
                .setRequired(true),
            ),
          );
        interaction.showModal(modal);
        return;
      }
      case "reset":
        this.sessions.update(session);
        await this.present(interaction,
          new ContainerBuilder()
              .addTextDisplayComponents(new TextDisplayBuilder().setContent("**Reset server settings?**\nThis restores the deployment defaults for every server switch, channels, cooldown, games and currency. Personal preferences are kept."))
            .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder().setCustomId(`st:reset:confirm:${session.id}`).setLabel("Confirm reset").setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`st:refresh:${session.id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
            )),
        );
        return;
      default:
        await this.render(session, interaction, isAdmin);
    }
  }

  private async applyServerField(
    interaction: PanelInteraction,
    session: SettingsSession,
    isAdmin: boolean,
    field: string,
    value: string,
  ): Promise<void> {
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
    const patch = serverPatch(field, value);
    if (!patch) return;
    const previous = describeField(before, field);
    this.store.update(session.guildId, patch);
    const after = this.store.get(session.guildId);
    const current = describeField(after, field);
    session.baseline = baselineOf(after);
    this.sessions.update(session);
    if (previous !== current) {
      await this.announceChange(interaction as PanelInteraction & { guildId: string }, [`${fieldName(field)}: ${previous} -> ${current}`]);
    }
    await this.renderCommitted(session, interaction, isAdmin, `Saved: ${current}`, current);
  }

  /**
   * The store has already committed, so a failed panel refresh must not be reported
   * as an ordinary failure. A private notice carries the outcome either way.
   */
  private async renderCommitted(
    session: SettingsSession,
    interaction: PanelInteraction,
    isAdmin: boolean,
    savedNotice: string,
    committedValue: string,
  ): Promise<void> {
    try {
      await this.render(session, interaction, isAdmin, undefined, savedNotice);
    } catch (error) {
      console.error(`settings panel refresh failed after a committed change (${errorCategory(error)})`);
      await interaction.followUp({ content: `${savedNotice}. The panel could not refresh; reopen it to see the new state.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }

  private async handleChannels(
    interaction: PanelInteraction,
    session: SettingsSession,
    isAdmin: boolean,
    parts: string[],
  ): Promise<void> {
    if (!session.guildId) return;
    if (!isAdmin) {
      await interaction.reply({ content: "Only members with the Manage Server permission can change server settings.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    const sub = parts[2] ?? "";
    const before = this.store.get(session.guildId);

    if (sub === "add") {
      const draft = new Set(session.draftChannelIds ?? before.selectedChannelIds);
      for (const id of interaction.values ?? []) draft.add(id);
      session.draftChannelIds = [...draft];
      this.sessions.update(session);
      await this.render(session, interaction, isAdmin, `${session.draftChannelIds.length} channel${session.draftChannelIds.length === 1 ? "" : "s"} in the draft. Save to apply.`);
      return;
    }

    if (sub === "cancel") {
      session.draftChannelIds = [...before.selectedChannelIds];
      this.sessions.update(session);
      await this.render(session, interaction, isAdmin);
      return;
    }

    if (sub === "remove-submit") {
      const draft = new Set(session.draftChannelIds ?? []);
      for (const id of interaction.values ?? []) draft.delete(id);
      session.draftChannelIds = [...draft];
      this.sessions.update(session);
      await this.render(session, interaction, isAdmin);
      return;
    }

    if (sub === "remove") {
      this.sessions.update(session);
      await this.render(session, interaction, isAdmin, "Choose the saved channels to remove from the menu below.");
      return;
    }

    if (sub === "save") {
      const draft = session.draftChannelIds ?? [];
      if (before.autoReplyChannelMode === "selected" && draft.length === 0) {
        this.sessions.update(session);
        await this.present(interaction,
          new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("**Save an empty selection?**\nWith Selected channels and no channels saved, automatic replies stop everywhere."))
            .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder().setCustomId(`st:ch:save-confirm:${session.id}`).setLabel("Stop replies everywhere").setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`st:ch:cancel:${session.id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
            )),
        );
        return;
      }
      await this.saveChannels(interaction, session, draft);
      return;
    }

    if (sub === "save-confirm") {
      await this.saveChannels(interaction, session, session.draftChannelIds ?? []);
      return;
    }

    if (sub === "all" || sub === "selected") {
      if (baselineOf(before) !== session.baseline) {
        session.baseline = baselineOf(before);
        this.sessions.update(session);
        await this.render(session, interaction, isAdmin, "These settings changed while you were here. Choose again.");
        return;
      }
      this.store.update(session.guildId, { autoReplyChannelMode: sub });
      const after = this.store.get(session.guildId);
      session.baseline = baselineOf(after);
      session.draftChannelIds = [...after.selectedChannelIds];
      this.sessions.update(session);
      const previous = before.autoReplyChannelMode === "all" ? "Everywhere" : "Selected channels";
      const current = sub === "all" ? "Everywhere" : "Selected channels";
      await this.render(session, interaction, isAdmin, undefined, `Saved: replies are allowed ${current.toLowerCase()}.`);
      if (previous !== current) {
        await this.announceChange(interaction as PanelInteraction & { guildId: string }, [`Automatic-reply channels: ${previous} -> ${current}`]);
      }
    }
  }

  private async saveChannels(
    interaction: PanelInteraction,
    session: SettingsSession,
    draft: string[],
  ): Promise<void> {
    if (!session.guildId) return;
    const before = this.store.get(session.guildId);
    if (baselineOf(before) !== session.baseline) {
      session.baseline = baselineOf(before);
      session.draftChannelIds = [...before.selectedChannelIds];
      this.sessions.update(session);
      await this.render(session, interaction, isAdminNow(interaction), "These settings changed while you were here. The draft was rebuilt from the current channels; make your choice again.");
      return;
    }
    const previousIds = [...before.selectedChannelIds].sort().join(",");
    const previous = before.autoReplyChannelMode === "all"
      ? "Everywhere"
      : `${before.selectedChannelIds.length} selected`;
    this.store.update(session.guildId, { autoReplyChannelMode: "selected", selectedChannelIds: draft });
    const after = this.store.get(session.guildId);
    session.baseline = baselineOf(after);
    session.draftChannelIds = [...after.selectedChannelIds];
    this.sessions.update(session);
    await this.render(session, interaction, isAdminNow(interaction), undefined, `Saved: replies are allowed in ${after.selectedChannelIds.length} channel${after.selectedChannelIds.length === 1 ? "" : "s"}.`);
    if (previous !== `${after.selectedChannelIds.length} selected` || previousIds !== [...after.selectedChannelIds].sort().join(",")) {
      await this.announceChange(interaction as PanelInteraction & { guildId: string }, [`Automatic-reply channels: ${previous} -> ${after.selectedChannelIds.length} selected`]);
    }
  }

  private async handleCooldownModal(interaction: PanelInteraction, isAdmin: boolean): Promise<void> {
    const sessionId = interaction.customId.split(":").pop() ?? "";
    const session = this.sessions.resolve(sessionId, interaction.user.id);
    if (!session || !session.guildId) {
      await interaction.reply({ content: "This panel has expired. Run /settings to open a new one.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    if (!isAdmin) {
      await interaction.reply({ content: "Only members with the Manage Server permission can change server settings.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    const raw = interaction.fields?.getTextInputValue("seconds").trim() ?? "";
    const seconds = Number(raw);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) {
      await this.render(session, interaction, isAdmin, `"${raw}" is not a whole number of seconds between 0 and 86400.`);
      return;
    }
    const before = this.store.get(session.guildId);
    if (baselineOf(before) !== session.baseline) {
      session.baseline = baselineOf(before);
      this.sessions.update(session);
      await this.render(session, interaction, isAdmin, "These settings changed while you were here. Choose again.");
      return;
    }
    this.store.update(session.guildId, { cooldownSeconds: seconds });
    const after = this.store.get(session.guildId);
    session.baseline = baselineOf(after);
    this.sessions.update(session);
    await this.render(session, interaction, isAdmin, undefined, `Saved: reply cooldown is ${seconds === 0 ? "off" : `${seconds}s`}.`);
    if (before.cooldownSeconds !== seconds) {
      await this.announceChange(interaction as PanelInteraction & { guildId: string }, [
        `Reply cooldown: ${before.cooldownSeconds === 0 ? "off" : `${before.cooldownSeconds}s`} -> ${seconds === 0 ? "off" : `${seconds}s`}`,
      ]);
    }
  }

  private async handleResetConfirm(interaction: PanelInteraction, isAdmin: boolean): Promise<void> {
    const sessionId = interaction.customId.split(":").pop() ?? "";
    const session = this.sessions.resolve(sessionId, interaction.user.id);
    if (!session || !session.guildId) {
      await interaction.reply({ content: "This panel has expired. Run /settings to open a new one.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    if (!isAdmin) {
      await interaction.reply({ content: "Only members with the Manage Server permission can reset server settings.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    const before = this.store.get(session.guildId);
    if (baselineOf(before) !== session.baseline) {
      session.baseline = baselineOf(before);
      this.sessions.update(session);
      await this.render(session, interaction, isAdmin, "These settings changed since you opened the reset confirmation. Review them and confirm the reset again.");
      return;
    }
    this.store.delete(session.guildId);
    const after = this.store.get(session.guildId);
    session.baseline = baselineOf(after);
    this.sessions.update(session);
    await this.announceChange(interaction as PanelInteraction & { guildId: string }, [
      "Server settings were reset to the deployment defaults.",
      ...resetLines(before, after),
    ]);
    await this.render(session, interaction, isAdmin, "Server settings were reset.");
  }

  private async announceChange(interaction: PanelInteraction & { guildId: string }, lines: string[]): Promise<void> {
    await this.announce?.(interaction.guildId, interaction.channelId, lines);
  }
}

interface PanelModelShape {
  session: SettingsSession;
  server?: GuildSettings;
  mentionEnabled: boolean;
  isAdmin: boolean;
  heading: string;
  rows: { label: string; value: string }[];
  notice?: string;
  savedNotice?: string;
}
