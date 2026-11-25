import { GatewayIntentBits, Partials, type ClientOptions } from "discord.js";
import type { Config } from "../config.js";

/** Sets intents and disables mention pings by default; messages can override the defaults. */
export function clientOptions(config: Pick<Config, "mentionEnabled">): ClientOptions {
  const intents = [GatewayIntentBits.Guilds];
  if (config.mentionEnabled) {
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages);
  }
  return {
    intents,
    ...(config.mentionEnabled ? { partials: [Partials.Channel] } : {}),
    allowedMentions: { parse: [], repliedUser: false },
  };
}
