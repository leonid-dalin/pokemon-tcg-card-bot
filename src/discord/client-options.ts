import { GatewayIntentBits, type ClientOptions } from "discord.js";
import type { Config } from "../config.js";

/**
 * Replies quote what people typed, so the bot never pings anyone: no
 * @everyone, no roles, no users and no reply ping. This is the client default
 * because discord.js uses a message's own allowedMentions instead of the
 * default, not on top of it, so replies must not set their own.
 */
export function clientOptions(config: Pick<Config, "mentionEnabled">): ClientOptions {
  const intents = [GatewayIntentBits.Guilds];
  if (config.mentionEnabled) {
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  }
  return { intents, allowedMentions: { parse: [], repliedUser: false } };
}
