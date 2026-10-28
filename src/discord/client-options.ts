import { GatewayIntentBits, type ClientOptions } from "discord.js";
import type { Config } from "../config.js";

/** Sets intents and disables mention pings by default; messages can override the defaults. */
export function clientOptions(config: Pick<Config, "mentionEnabled">): ClientOptions {
  const intents = [GatewayIntentBits.Guilds];
  if (config.mentionEnabled) {
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  }
  return { intents, allowedMentions: { parse: [], repliedUser: false } };
}
