import { GatewayIntentBits, Partials } from "discord.js";
import { describe, expect, it } from "vitest";
import { clientOptions } from "../src/discord/client-options.js";

describe("clientOptions", () => {
  it("never lets a reply ping anyone", () => {
    expect(clientOptions({ mentionEnabled: true }).allowedMentions).toEqual({ parse: [], repliedUser: false });
  });

  it("asks for message content only when mention replies are on", () => {
    expect(clientOptions({ mentionEnabled: true }).intents).toEqual([
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ]);
    expect(clientOptions({ mentionEnabled: false }).intents).toEqual([GatewayIntentBits.Guilds]);
  });

  it("handles uncached DM channels only when message replies are on", () => {
    expect(clientOptions({ mentionEnabled: true }).partials).toContain(Partials.Channel);
    expect(clientOptions({ mentionEnabled: false }).partials).toBeUndefined();
  });
});
