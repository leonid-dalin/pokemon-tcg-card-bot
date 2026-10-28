import type { Message } from "discord.js";
import type { TcgdexClient } from "../api/tcgdex.js";
import type { Config } from "../config.js";
import type { MentionBudget } from "../cooldown.js";
import { parseDecklist } from "../decklist.js";
import { lookupCard, suggestNames, type CardLookup } from "../lookup.js";
import { extractMentions, parseSearchCommand } from "../mentions.js";
import { renderDecklist } from "../render.js";
import { searchCardText } from "../text-search.js";
import { toEmbeds } from "./embeds.js";
import { MAX_EMBEDS_PER_MESSAGE, mentionReply, searchReply, type MentionMiss } from "./replies.js";

export interface MessageContext {
  api: TcgdexClient;
  config: Pick<Config, "mentionEnabled" | "decklistEnabled" | "attribution">;
  budget?: MentionBudget | undefined;
  /** The bot's own user id, once the gateway has reported it. */
  selfId: () => string | undefined;
}

/** The fields of a Discord message the handler reads. */
export type IncomingMessage = Pick<
  Message,
  "author" | "webhookId" | "system" | "content" | "attachments" | "embeds" | "stickers" | "channelId" | "reply"
>;

const quiet = { allowedMentions: { repliedUser: false } } as const;

/**
 * Build the MessageCreate handler. Each message gets at most one reply: a
 * decklist, an `@bot search` answer, or the cards its `[[...]]` mentions name.
 */
export function createMessageHandler(context: MessageContext): (message: IncomingMessage) => Promise<void> {
  const { api, config, budget } = context;
  let warnedAboutContent = false;

  return async (message) => {
    if (!config.mentionEnabled) return;
    if (message.author.bot || message.webhookId) return;
    if (message.system) return;

    // With the Message Content intent switched off Discord still delivers the
    // event but strips the text, which looks like the bot ignoring everyone.
    // Attachments, embeds and stickers are legitimately text-free, so they are
    // not evidence of a missing intent.
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

    // Work out what the message asks for before spending anything on it.
    const deck = config.decklistEnabled ? parseDecklist(message.content) : undefined;
    // Slash commands need the command picker, which is awkward on a phone. A
    // mention plus the word search does the same job from the message box.
    const selfId = context.selfId();
    const searchQuery = !deck && selfId ? parseSearchCommand(message.content, selfId) : undefined;
    const mentions = deck || searchQuery !== undefined ? [] : extractMentions(message.content);
    if (!deck && searchQuery === undefined && mentions.length === 0) return;

    // Every reply draws on the same budget, so a decklist or a search cannot be
    // used to get round the limit on mentions. Keyed per member, not per
    // channel: a channel-wide budget lets one person's request swallow
    // everyone else's.
    if (budget) {
      const verdict = budget.take(`${message.channelId}:${message.author.id}`);
      if (!verdict.allowed) {
        console.log(`skipped a reply to ${message.author.username}: ${verdict.retryAfterSeconds}s until the next one`);
        return;
      }
    }

    if (deck) {
      await message.reply({ embeds: toEmbeds([renderDecklist(deck)]), ...quiet }).catch(() => {});
      return;
    }

    if (searchQuery !== undefined) {
      if (searchQuery.length === 0) {
        await message
          .reply({ content: "Add what to look for after search, for example: search stadium.", ...quiet })
          .catch(() => {});
        return;
      }
      try {
        const reply = searchReply(searchQuery, searchCardText(searchQuery), config.attribution);
        await message.reply({ ...reply, ...quiet }).catch(() => {});
      } catch (error) {
        console.error("mention search failed", error);
        await message.reply({ content: "Card search failed, try again in a moment.", ...quiet }).catch(() => {});
      }
      return;
    }

    try {
      const found: CardLookup[] = [];
      const misses: MentionMiss[] = [];
      for (const mention of mentions) {
        const lookup = await lookupCard(api, mention.name, mention.setHint, { attribution: config.attribution });
        console.log(`mention [[${mention.raw}]] -> ${lookup ? lookup.card.id : "no match"}`);
        if (lookup) found.push(lookup);
        else misses.push({ raw: mention.raw, closest: await suggestNames(api, mention.name) });
        if (found.length >= MAX_EMBEDS_PER_MESSAGE) break;
      }
      await message.reply({ ...mentionReply(found, misses), ...quiet });
    } catch (error) {
      console.error("mention lookup failed", error);
      // A dead API used to leave the channel with nothing at all.
      await message.reply({ content: "Card lookup failed, try again in a moment.", ...quiet }).catch(() => {});
    }
  };
}
