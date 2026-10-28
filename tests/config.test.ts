import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const required = { DISCORD_TOKEN: "token", DISCORD_CLIENT_ID: "123" };

describe("loadConfig", () => {
  it("applies the documented defaults", () => {
    expect(loadConfig(required)).toEqual({
      token: "token",
      clientId: "123",
      mentionEnabled: true,
      decklistEnabled: false,
      mentionCooldownSeconds: 0,
      attribution: "Card data from TCGdex",
    });
  });

  it("reads every optional setting", () => {
    const config = loadConfig({
      ...required,
      DISCORD_GUILD_ID: "456",
      MENTION_ENABLED: "false",
      DECKLIST_ENABLED: "yes",
      MENTION_COOLDOWN_SECONDS: "30",
      ATTRIBUTION: "Data from somewhere",
    });
    expect(config).toMatchObject({
      guildId: "456",
      mentionEnabled: false,
      decklistEnabled: true,
      mentionCooldownSeconds: 30,
      attribution: "Data from somewhere",
    });
  });

  it.each(["DISCORD_TOKEN", "DISCORD_CLIENT_ID"])("refuses to start without %s", (key) => {
    expect(() => loadConfig({ ...required, [key]: " " })).toThrow(`${key} is required`);
  });
});
