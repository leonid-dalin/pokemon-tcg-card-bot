import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from "discord.js";
import type { GuildSettings } from "../settings-store.js";
import type { SettingsSession } from "./settings-session.js";

export type PanelScreen = SettingsSession["screen"];

export interface PanelModel {
  session: SettingsSession;
  /** The server's stored settings, when the panel is opened in a server. */
  server?: GuildSettings;
  /** The deployment switch; when off, nothing can enable message replies. */
  mentionEnabled: boolean;
  isAdmin: boolean;
  heading: string;
  rows: { label: string; value: string }[];
  notice?: string;
  savedNotice?: string;
}

export const SCOPE_PERSONAL = "personal";
export const SCOPE_SERVER = "server";

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small);
}

function button(customId: string, label: string, style: ButtonStyle): ButtonBuilder {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

/** The scope-switch row; only a server panel offers the server view. */
function scopeRow(model: PanelModel): ActionRowBuilder<ButtonBuilder> {
  const personal = button(`st:scope:${SCOPE_PERSONAL}:${model.session.id}`, "For me", ButtonStyle.Secondary);
  const server = button(`st:scope:${SCOPE_SERVER}:${model.session.id}`, "This server", ButtonStyle.Secondary);
  if (model.session.scope === "personal") personal.setStyle(ButtonStyle.Primary);
  else server.setStyle(ButtonStyle.Primary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(personal, server);
}

function navRow(model: PanelModel): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`st:nav:${model.session.id}`)
    .setPlaceholder("Choose a section")
    .addOptions(
      { label: "Overview", value: "overview" },
      { label: "Replies", value: "replies" },
      { label: "Channels", value: "channels" },
      { label: "Card games", value: "games" },
      { label: "Currency", value: "currency" },
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function footerRow(model: PanelModel, canReset: boolean): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`st:refresh:${model.session.id}`, "Refresh", ButtonStyle.Secondary),
    button(`st:close:${model.session.id}`, "Close", ButtonStyle.Secondary),
  );
  if (canReset) row.addComponents(button(`st:reset:${model.session.id}`, "Reset server settings", ButtonStyle.Danger));
  return [row];
}

/** Renders one panel screen as a Components V2 container. */
export function renderPanel(model: PanelModel): ContainerBuilder {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(text(`**Crustlebot settings · ${model.heading}**`));
  container.addSeparatorComponents(separator());
  if (model.session.guildId) {
    container.addActionRowComponents(scopeRow(model));
    container.addSeparatorComponents(separator());
  }
  for (const row of model.rows) {
    container.addTextDisplayComponents(text(`**${row.label}**\n${row.value}`));
  }
  if (model.notice) {
    container.addSeparatorComponents(separator());
    container.addTextDisplayComponents(text(`-# ${model.notice}`));
  }
  if (model.savedNotice) {
    container.addSeparatorComponents(separator());
    container.addTextDisplayComponents(text(`✅ ${model.savedNotice}`));
  }
  container.addSeparatorComponents(separator());

  const isAdmin = model.isAdmin && model.session.scope === "server";
  if (model.session.screen === "personal" || model.session.scope === "personal") {
    for (const row of personalActions(model.session.id)) container.addActionRowComponents(row);
  } else if (isAdmin) {
    switch (model.session.screen) {
      case "replies":
        for (const row of repliesActions(model.server, model.session.id)) container.addActionRowComponents(row);
        break;
      case "currency":
        container.addActionRowComponents(currencyActions(model.session.id));
        break;
      case "channels":
        for (const row of channelDraftActions(model.session.draftChannelIds ?? [], model.session.id)) {
          container.addActionRowComponents(row);
        }
        if (model.session.draftChannelIds && model.session.draftChannelIds.length > 0 && model.notice === undefined) {
          container.addActionRowComponents(removeActions(model.session.draftChannelIds, model.session.id));
        }
        break;
      case "games":
        for (const row of gamesActions(model.session.id)) container.addActionRowComponents(row);
        break;
      default:
        container.addActionRowComponents(navRow(model));
    }
  } else if (model.session.scope === "server" && model.session.screen !== "overview") {
    container.addActionRowComponents(navRow(model));
  } else if (model.session.screen === "overview" && isAdmin) {
    container.addActionRowComponents(navRow(model));
  }

  for (const row of footerRow(model, isAdmin)) container.addActionRowComponents(row);
  return container;
}

function repliesActions(server: GuildSettings | undefined, sessionId: string): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  if (!server) throw new Error("reply switches need server settings");
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`st:set:messages:on:${sessionId}`, "Enable message replies", server.messageReplies ? ButtonStyle.Success : ButtonStyle.Secondary),
    button(`st:set:messages:off:${sessionId}`, "Disable message replies", server.messageReplies ? ButtonStyle.Secondary : ButtonStyle.Danger),
    button(`st:set:decklists:on:${sessionId}`, "Enable decklist replies", server.decklistReplies ? ButtonStyle.Success : ButtonStyle.Secondary),
    button(`st:set:decklists:off:${sessionId}`, "Disable decklist replies", server.decklistReplies ? ButtonStyle.Secondary : ButtonStyle.Danger),
  );
  const presets = new StringSelectMenuBuilder()
    .setCustomId(`st:set:cooldown:${sessionId}`)
    .setPlaceholder("Reply cooldown")
    .addOptions(
      { label: "Off", value: "0" },
      { label: "5 seconds", value: "5" },
      { label: "15 seconds", value: "15" },
      { label: "30 seconds", value: "30" },
      { label: "60 seconds", value: "60" },
    );
  const custom = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`st:cooldown-custom:${sessionId}`, "Custom...", ButtonStyle.Secondary),
  );
  return [buttons, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(presets), custom];
}

function gamesActions(sessionId: string): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const allowed = new StringSelectMenuBuilder()
    .setCustomId(`st:set:games:${sessionId}`)
    .setPlaceholder("Card games")
    .addOptions(
      { label: "Physical game", value: "ptcg" },
      { label: "Pocket", value: "pocket" },
      { label: "Both", value: "both" },
    );
  const preferred = new StringSelectMenuBuilder()
    .setCustomId(`st:set:defaultgame:${sessionId}`)
    .setPlaceholder("Preferred game when both")
    .addOptions(
      { label: "Physical preferred", value: "ptcg" },
      { label: "Pocket preferred", value: "pocket" },
    );
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(allowed),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(preferred),
  ];
}

function channelDraftActions(draft: string[], sessionId: string): ActionRowBuilder<ChannelSelectMenuBuilder | ButtonBuilder>[] {
  const picker = new ChannelSelectMenuBuilder()
    .setCustomId(`st:ch:add:${sessionId}`)
    .setPlaceholder("Add channels (up to 25 at once)")
    .setMinValues(1)
    .setMaxValues(25)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  const rows: ActionRowBuilder<ChannelSelectMenuBuilder | ButtonBuilder>[] = [
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(picker) as never,
  ];
  if (draft.length > 0) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(`st:ch:save:${sessionId}`, `Save ${draft.length} selected channel${draft.length === 1 ? "" : "s"}`, ButtonStyle.Success),
      button(`st:ch:remove:${sessionId}`, "Remove channels", ButtonStyle.Secondary),
      button(`st:ch:cancel:${sessionId}`, "Cancel", ButtonStyle.Secondary),
    ));
  }
  return rows;
}

function removeActions(draft: string[], sessionId: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`st:ch:remove-submit:${sessionId}`)
    .setPlaceholder("Choose saved channels to remove")
    .setMinValues(1)
    .setMaxValues(Math.min(25, draft.length))
    .addOptions(draft.slice(0, 25).map((id) => ({ label: id, value: id })));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function currencyActions(sessionId: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`st:set:currency:${sessionId}`)
    .setPlaceholder("Server default currency")
    .addOptions(
      { label: "EUR", value: "EUR" },
      { label: "USD", value: "USD" },
      { label: "GBP", value: "GBP" },
      { label: "JPY", value: "JPY" },
      { label: "CNY", value: "CNY" },
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function personalActions(sessionId: string): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const mentions = new StringSelectMenuBuilder()
    .setCustomId(`st:my:mentions:${sessionId}`)
    .setPlaceholder("Automatic replies")
    .addOptions(
      { label: "Follow each server", value: "default" },
      { label: "On", value: "on" },
      { label: "Off", value: "off" },
    );
  const currency = new StringSelectMenuBuilder()
    .setCustomId(`st:my:currency:${sessionId}`)
    .setPlaceholder("Price currency")
    .addOptions(
      { label: "Follow each server", value: "default" },
      { label: "EUR", value: "EUR" },
      { label: "USD", value: "USD" },
      { label: "GBP", value: "GBP" },
      { label: "JPY", value: "JPY" },
      { label: "CNY", value: "CNY" },
    );
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(mentions),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(currency),
  ];
}

function channelsActions(server: GuildSettings | undefined): ActionRowBuilder<ButtonBuilder> {
  if (!server) throw new Error("channel controls need server settings");
  const everywhere = server.autoReplyChannelMode === "all";
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    button("st:ch:all", "Everywhere", everywhere ? ButtonStyle.Primary : ButtonStyle.Secondary),
    button("st:ch:selected", "Selected channels", everywhere ? ButtonStyle.Secondary : ButtonStyle.Primary),
  );
}
