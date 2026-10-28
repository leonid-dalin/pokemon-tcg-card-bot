import type { Message } from "discord.js";
import type { TcgdexClient } from "../api/tcgdex.js";
import type { Config } from "../config.js";
import type { MentionBudget } from "../cooldown.js";
import { parseDecklist } from "../decklist.js";
import { resolveDeckCards } from "../deck-check.js";
import { errorCategory } from "../diagnostics.js";
import { lookupCard, suggestNames, type CardLookup } from "../lookup.js";
import { extractMentions, parseHelpCommand, parseSearchCommand } from "../mentions.js";
import { renderDecklist } from "../render.js";
import { searchCardGroups } from "../text-search.js";
import { helpView } from "../help.js";
import { toEmbeds } from "./embeds.js";
import { MAX_EMBEDS_PER_MESSAGE, mentionReply, searchReply, type MentionMiss } from "./replies.js";

export interface MessageContext {
  api: TcgdexClient;
  config: Pick<Config, "mentionEnabled" | "decklistEnabled" | "attribution" | "energyEmoji">;
  pages: import("./pages.js").PageStore;
  budget?: MentionBudget | undefined;
  invocations?: { record: (entry: import("../invocation-log.js").InvocationEntry) => void } | undefined;
  /** The bot's own user id, once the gateway has reported it. */
  selfId: () => string | undefined;
}

export type IncomingMessage = Pick<
  Message,
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
  | "reply"
>;

interface ReplyPayload {
  content?: string;
  embeds?: { description?: string; title?: string }[];
}

function embedText(embed: { title?: string; description?: string; data?: { title?: string; description?: string } }): string {
  const title = embed.title ?? embed.data?.title;
  const description = embed.description ?? embed.data?.description;
  return [title, description].filter(Boolean).join("\n");
}

function replyText(payload: ReplyPayload): string {
  const parts = [payload.content ?? "", ...(payload.embeds ?? []).map(embedText)];
  return parts.filter(Boolean).join("\n\n");
}

/** Routes eligible messages to help, decklist, search or card replies. */
export function createMessageHandler(context: MessageContext): (message: IncomingMessage) => Promise<void> {
  const { api, config, budget } = context;
  let warnedAboutContent = false;

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

    const deck = config.decklistEnabled ? parseDecklist(message.content) : undefined;
    const selfId = context.selfId();
    // A bare bot mention is help; parse it before checking for a search query.
    const wantsHelp = !deck && selfId ? parseHelpCommand(message.content, selfId) : undefined;
    const searchQuery = !deck && !wantsHelp && selfId ? parseSearchCommand(message.content, selfId) : undefined;
    const mentions = deck || wantsHelp || searchQuery !== undefined ? [] : extractMentions(message.content);
    if (!deck && !wantsHelp && searchQuery === undefined && mentions.length === 0) return;

    const isAdmin = Boolean(message.member?.permissions?.has?.("ManageGuild"));
    const logReply = async (payload: ReplyPayload) => {
      context.invocations?.record({
        ...(message.guildId ? { guildId: message.guildId } : {}),
        channelId: message.channelId,
        isAdmin,
        trigger: message.content,
        reply: replyText(payload),
      });
      await message.reply(payload as never).catch(() => {});
    };

    // Apply the same per-member, per-channel budget to every message reply.
    if (budget) {
      const verdict = budget.take(`${message.channelId}:${message.author.id}`);
      if (!verdict.allowed) {
        console.log(`skipped a reply: ${verdict.retryAfterSeconds}s until the next one`);
        return;
      }
    }

    if (wantsHelp) {
      await logReply({ embeds: toEmbeds([helpView()]) as never });
      return;
    }

    if (deck) {
      const resolved = config.decklistEnabled ? await resolveDeckCards(api, deck).catch(() => undefined) : undefined;
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

    try {
      const found: CardLookup[] = [];
      const misses: MentionMiss[] = [];
      for (const mention of mentions) {
        const lookup = await lookupCard(api, mention.name, mention.setHint, {
          attribution: config.attribution,
          energyEmoji: config.energyEmoji,
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
