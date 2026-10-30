import { EmbedBuilder, type Message } from "discord.js";
import type { TcgdexClient } from "../api/tcgdex.js";
import type { Config } from "../config.js";
import { MentionBudget } from "../cooldown.js";
import { parseDecklist } from "../decklist.js";
import { resolveDeckCards } from "../deck-check.js";
import { errorCategory } from "../diagnostics.js";
import { lookupCard, suggestNames, type CardLookup } from "../lookup.js";
import { extractMentions, parseHelpCommand, parseInlineCommand, parseSearchCommand } from "../mentions.js";
import { listReply, type ListPage } from "./pages.js";
import { printingsOf, printingItems } from "../printings.js";
import { renderSet } from "../render.js";
import { resolveSetHint } from "../set-index.js";
import { normaliseName } from "../resolve.js";
import { footerFor } from "./commands.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { toEmbed } from "./embeds.js";
import { versionActions, versionEmbed, versionLines } from "./version-view.js";
import { busyMessage, overloadHint } from "./interaction-failure.js";
import { renderDecklist } from "../render.js";
import { searchCardGroups } from "../text-search.js";
import { helpView } from "../help.js";
import { toEmbeds } from "./embeds.js";
import { MAX_EMBEDS_PER_MESSAGE, mentionReply, searchReply, type MentionMiss } from "./replies.js";

export interface MessageContext {
  api: TcgdexClient;
  config: Pick<Config, "mentionEnabled" | "decklistEnabled" | "mentionCooldownSeconds" | "attribution" | "energyEmoji">;
  pages: import("./pages.js").PageStore;
  budget?: MentionBudget | undefined;
  requests?: MentionBudget | undefined;
  invocations?: { record: (entry: import("../invocation-log.js").InvocationEntry) => void } | undefined;
  settings?: {
    get: (guildId: string) => import("../settings-store.js").GuildSettings;
    messageRepliesFor?: (userId: string) => boolean | undefined;
  } | undefined;
  /** The bot's own user id, once the gateway has reported it. */
  selfId: () => string | undefined;
  /** Durable 90-second cleanup for temporary mention-command exchanges. */
  cleanup?: { schedule: (job: { botMessageId: string; channelId: string; invokeMessageId: string }) => void } | undefined;
}

export interface EffectiveGuildSettings {
  messageReplies: boolean;
  decklistReplies: boolean;
  autoReplyChannelMode: "all" | "selected";
  selectedChannelIds: string[];
  cooldownSeconds: number;
  cardGames: "ptcg" | "pocket" | "both";
  defaultCardGame: "ptcg" | "pocket";
}

export type IncomingMessage = Pick<
  Message,
  | "id"
  | "author"
  | "webhookId"
  | "system"
  | "content"
  | "attachments"
  | "embeds"
  | "stickers"
  | "channelId"
  | "guildId"
  | "member"
  | "channel"
  | "reply"
>;

interface ReplyPayload {
  content?: string;
  embeds?: (EmbedBuilder | { description?: string; title?: string })[];
  components?: unknown[];
}

function embedText(embed: {
  title?: string;
  description?: string;
  fields?: { name?: string; value?: string }[];
  data?: { title?: string; description?: string; fields?: { name?: string; value?: string }[] };
}): string {
  const plain = embed.data ?? {};
  const title = embed.title ?? plain.title;
  const description = embed.description ?? plain.description;
  const fields = embed.fields ?? plain.fields ?? [];
  const parts = [title, description, ...fields.map((field) => [field.name, field.value].filter(Boolean).join(": "))];
  return parts.filter(Boolean).join("\n");
}

function replyText(payload: ReplyPayload): string {
  const parts = [payload.content ?? "", ...(payload.embeds ?? []).map(embedText)];
  return parts.filter(Boolean).join("\n\n");
}

/** Routes eligible messages to help, decklist, search or card replies. */
export function createMessageHandler(context: MessageContext): (message: IncomingMessage) => Promise<void> {
  const { api, config, budget, requests } = context;
  let warnedAboutContent = false;
  const guildBudgets = new Map<string, { refillSeconds: number; budget: MentionBudget | undefined }>();
  const MAX_GUILD_BUDGETS = 1000;

  return async (message) => {
    if (!config.mentionEnabled) return;
    if (message.author.bot || message.webhookId) return;
    if (message.system) return;

    // Warn once when plain text is missing without attachments, embeds or stickers.
    // Discord may strip the text when the Message Content intent is disabled.
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

    let guild: EffectiveGuildSettings | undefined;
    let personalReplies: boolean | undefined;
    if (context.settings) {
      try {
        if (message.guildId) guild = context.settings.get(message.guildId);
        personalReplies = context.settings.messageRepliesFor?.(message.author.id);
      } catch (error) {
        console.error(`settings read failed (${errorCategory(error)})`);
        return;
      }
    }
    const decklistOn = guild ? guild.decklistReplies : config.decklistEnabled;
    const gamePreference = guild ? { allowed: guild.cardGames, default: guild.defaultCardGame } : undefined;
    const serverReplies = guild ? guild.messageReplies : true;
    // A member's own choice overrides the server switch, as the command advertises.
    const messageRepliesOn = personalReplies ?? serverReplies;

    const deck = decklistOn ? parseDecklist(message.content) : undefined;
    const selfId = context.selfId();
    // A bare bot mention is help; parse it before checking for a search query.
    // Decklists answer on their own switch, so message replies off mutes only
    // mentions, searches and help.
    const wantsHelp = !deck && messageRepliesOn && selfId ? parseHelpCommand(message.content, selfId) : undefined;
    const inline =
      !deck && !wantsHelp && messageRepliesOn && selfId ? parseInlineCommand(message.content, selfId) : undefined;
    const searchQuery =
      !deck && !wantsHelp && inline === undefined && messageRepliesOn && selfId
        ? parseSearchCommand(message.content, selfId)
        : undefined;
    const mentions =
      deck || wantsHelp || searchQuery !== undefined ? [] : messageRepliesOn ? extractMentions(message.content) : [];
    if (!deck && !wantsHelp && inline === undefined && searchQuery === undefined && mentions.length === 0) return;

    const channel = message.channel as { isThread?: () => boolean; parentId?: string | null } | undefined;
    const replyChannelId = channel?.isThread?.() ? (channel.parentId ?? message.channelId) : message.channelId;
    if (guild && guild.autoReplyChannelMode === "selected" && !guild.selectedChannelIds.includes(replyChannelId)) return;
    const isAdmin = Boolean(message.member?.permissions?.has?.("ManageGuild"));
    const redactUserMentions = (text: string) => text.replace(/<@[!&]?\d+>/g, "<@user>");
    const logReply = async (payload: ReplyPayload) => {
      const entry = {
        ...(message.guildId ? { guildId: message.guildId } : {}),
        channelId: message.channelId,
        isAdmin,
        trigger: redactUserMentions(message.content),
        reply: redactUserMentions(replyText(payload)),
      };
      await message.reply(payload as never).then(() => {
        context.invocations?.record(entry);
      }).catch(() => {});
    };

    let activeBudget = budget;
    if (message.guildId) {
      const cooldown = guild ? guild.cooldownSeconds : config.mentionCooldownSeconds;
      const cached = guildBudgets.get(message.guildId);
      if (cached && cached.refillSeconds === cooldown) {
        activeBudget = cached.budget;
      } else {
        activeBudget = cooldown > 0 ? new MentionBudget({ refillSeconds: cooldown }) : undefined;
        if (guildBudgets.size >= MAX_GUILD_BUDGETS) {
          guildBudgets.delete(guildBudgets.keys().next().value as string);
        }
        guildBudgets.set(message.guildId, { refillSeconds: cooldown, budget: activeBudget });
      }
    }

    // Apply the same per-member, per-channel budget to every message reply.
    if (activeBudget) {
      const verdict = activeBudget.take(`${message.channelId}:${message.author.id}`);
      if (!verdict.allowed) {
        console.log(`skipped a reply: ${verdict.retryAfterSeconds}s until the next one`);
        return;
      }
    }

    if (wantsHelp) {
      await logReply({ embeds: toEmbeds([helpView()]) as never });
      return;
    }

    if (inline) {
      const cleanup = context.cleanup;
      const commandMessageId = message.id;
      const finish = async (payload: ReplyPayload): Promise<void> => {
        const sent = await message.reply(payload as never).catch(() => undefined);
        if (cleanup && sent) {
          cleanup.schedule({ botMessageId: sent.id, channelId: message.channelId, invokeMessageId: commandMessageId });
        }
      };
      await runInline(inline, {
        api,
        pages: context.pages,
        attribution: config.attribution,
        energyEmoji: config.energyEmoji,
        settings: context.settings,
        mentionEnabled: config.mentionEnabled,
        guildId: message.guildId,
        authorId: message.author.id,
        allowedGames: guild ? guild.cardGames : "both",
        requests: context.requests,
        messageRepliesFor: context.settings
          ? (userId: string) => context.settings!.messageRepliesFor!(userId)
          : undefined,
        reply: finish,
      });
      return;
    }

    if (deck) {
      const resolved = decklistOn ? await resolveDeckCards(api, deck).catch(() => undefined) : undefined;
      await logReply({ embeds: toEmbeds([renderDecklist(deck, resolved)]) as never });
      return;
    }

    if (searchQuery !== undefined) {
      if (searchQuery.length === 0) {
        await logReply({ content: "Add what to look for after search, for example: search stadium." });
        return;
      }
      try {
        const reply = searchReply(searchQuery, searchCardGroups(searchQuery), config.attribution, message.author.id, context.pages);
        await logReply(reply as ReplyPayload);
      } catch (error) {
        console.error(`mention search failed (${errorCategory(error)})`);
        await logReply({ content: "Card search failed, try again in a moment." });
      }
      return;
    }

    if (requests) {
      const admission = requests.take(message.guildId ? `${message.guildId}:${message.author.id}` : `dm:${message.author.id}`);
      if (!admission.allowed) {
        await logReply({ content: `The card service is busy. Try again in ${admission.retryAfterSeconds} second${admission.retryAfterSeconds === 1 ? "" : "s"}.` });
        return;
      }
    }

    try {
      const found: CardLookup[] = [];
      const misses: MentionMiss[] = [];
      for (const mention of mentions) {
        const lookup = await lookupCard(api, mention.name, mention.setHint, {
          attribution: config.attribution,
          energyEmoji: config.energyEmoji,
          ...(gamePreference ? { gamePreference } : {}),
        });
        console.log(`mention lookup -> ${lookup ? lookup.card.id : "no match"}`);
        if (lookup) found.push(mention.imageOnly ? { ...lookup, imageOnly: true } : lookup);
        else misses.push({ raw: mention.raw, closest: await suggestNames(api, mention.name, 5) });
        if (found.length >= MAX_EMBEDS_PER_MESSAGE) break;
      }
      await logReply(mentionReply(found, misses, message.author.id) as ReplyPayload);
    } catch (error) {
      console.error(`mention lookup failed (${errorCategory(error)})`);
      await logReply({ content: "Card lookup failed, try again in a moment." });
    }
  };
}


interface InlineInvocation {
  command: "version" | "settings" | "printings" | "set";
  argument: string;
}

interface InlineContext {
  api: TcgdexClient;
  pages: import("./pages.js").PageStore;
  attribution: string;
  energyEmoji: Record<string, string>;
  settings?: {
    get: (guildId: string) => import("../settings-store.js").GuildSettings;
  } | undefined;
  mentionEnabled: boolean;
  guildId: string | null;
  authorId: string;
  allowedGames: "ptcg" | "pocket" | "both";
  requests?: { take: (key: string) => { allowed: true } | { allowed: false; retryAfterSeconds: number } } | undefined;
  messageRepliesFor?: (userId: string) => boolean | undefined;
  reply: (payload: ReplyPayload) => Promise<void>;
}

function admit(context: InlineContext): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  if (!context.requests) return { allowed: true };
  return context.requests.take(context.guildId ? `${context.guildId}:${context.authorId}` : `dm:${context.authorId}`);
}

/** Serves the plain-text counterparts of /version, /settings, /printings and /set. */
async function runInline(inline: InlineInvocation, context: InlineContext): Promise<void> {
  if (inline.command === "version") {
    await context.reply({ embeds: [versionEmbed()], components: versionActions() } as never);
    return;
  }

  if (inline.command === "settings") {
    // A public reply cannot be private, so the reply is a temporary launcher
    // and the panel itself opens privately for whoever presses the button.
    await context.reply({
      embeds: [{ title: "Crustlebot settings", description: "Press below to open your settings panel. This message disappears in 90 seconds." }],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("st:launcher").setLabel("Open settings").setStyle(ButtonStyle.Primary),
      )],
    } as never);
    return;
  }

  if (inline.command === "printings") {
    // The image-only bang belongs to card mentions; a printings list is text by nature.
    const name = inline.argument.replace(/^!/, "").trim();
    if (!name) {
      await context.reply({ content: "Add a card name, for example: printings Pikachu." });
      return;
    }
    if (normaliseName(name).length < 2) {
      await context.reply({ content: `No card matched \`${name}\`. A single letter is too little to search on.` });
      return;
    }
    const admission = admit(context);
    if (!admission.allowed) {
      await context.reply({ content: busyMessage(admission.retryAfterSeconds) });
      return;
    }
    let printings: Awaited<ReturnType<typeof printingsOf>>;
    try {
      printings = await printingsOf(context.api, name, context.allowedGames);
    } catch (error) {
      const hint = overloadHint(error);
      await context.reply({ content: hint === undefined ? "Card lookup failed, try again in a moment." : busyMessage(hint) });
      return;
    }
    if (printings.length === 0) {
      await context.reply({ content: `No card matched \`${name}\`.` });
      return;
    }
    const page: ListPage = {
      title: `${printings.length} ${printings.length === 1 ? "printing" : "printings"} of ${printings[0]!.name}`,
      items: printingItems(printings),
      perPage: 10,
      ownerId: context.authorId,
      footer: footerFor(printings, context.attribution),
    };
    const token = context.pages.put(page);
    await context.reply(listReply(page, token, 0) as ReplyPayload);
    return;
  }

  if (!inline.argument) {
    await context.reply({ content: "Add a set id, for example: set sv01." });
    return;
  }
  const admission = admit(context);
  if (!admission.allowed) {
    await context.reply({ content: busyMessage(admission.retryAfterSeconds) });
    return;
  }
  try {
    const resolved = resolveSetHint(inline.argument);
    const set = await context.api.getSet(resolved ?? inline.argument);
    await context.reply({ embeds: [toEmbed(renderSet(set, context.attribution))] } as never);
  } catch (error) {
    const hint = overloadHint(error);
    if (hint !== undefined) {
      await context.reply({ content: busyMessage(hint) });
      return;
    }
    await context.reply({ content: `No set matched \`${inline.argument}\`.` });
  }
}
