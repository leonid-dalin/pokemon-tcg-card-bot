import { readFileSync } from "node:fs";
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
      energyEmoji: {},
      invocationLogRetentionDays: 60,
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
      ENERGY_EMOJI: '{"Fighting":"<:fighting:123>"}',
    });
    expect(config).toMatchObject({
      guildId: "456",
      mentionEnabled: false,
      decklistEnabled: true,
      mentionCooldownSeconds: 30,
      attribution: "Data from somewhere",
      energyEmoji: { Fighting: "<:fighting:123>" },
    });
  });

  it("documents every setting it reads in .env.example", () => {
    const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    const documented = [...example.matchAll(/^#?\s*([A-Z_]+)=/gm)].map((match) => match[1]).sort();
    const source = readFileSync(new URL("../src/config.ts", import.meta.url), "utf8");
    const read = [...new Set([...source.matchAll(/env\.([A-Z_]+)/g)].map((match) => match[1]))].sort();
    expect(documented).toEqual(read);
  });

  it("rejects a non-object energy emoji setting", () => {
    expect(() => loadConfig({ ...required, ENERGY_EMOJI: "[]" })).toThrow(
      "ENERGY_EMOJI must be a JSON object of energy type to emoji",
    );
  });

  it.each(["DISCORD_TOKEN", "DISCORD_CLIENT_ID"])("refuses to start without %s", (key) => {
    expect(() => loadConfig({ ...required, [key]: " " })).toThrow(`${key} is required`);
  });
});
