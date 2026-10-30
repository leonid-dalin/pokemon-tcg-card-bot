import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmbedBuilder } from "discord.js";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { parseInlineCommand } from "../src/mentions.js";
import { createMessageHandler } from "../src/discord/messages.js";

afterEach(() => vi.unstubAllGlobals());

const SELF = "999000111222333444";

function handler(overrides: Record<string, unknown> = {}) {
  return createMessageHandler({
    api: new TcgdexClient({ retries: 0 }),
    config: { mentionEnabled: true, decklistEnabled: false, mentionCooldownSeconds: 0, attribution: "Card data from TCGdex", energyEmoji: {} },
    pages: { put: () => "tok", get: () => undefined, set: () => undefined, delete: () => undefined } as never,
    settings: {
      get: () => ({
        guildId: "guild-a", messageReplies: true, decklistReplies: false,
        autoReplyChannelMode: "all" as const, selectedChannelIds: [], cooldownSeconds: 0,
        cardGames: "both" as const, defaultCardGame: "ptcg" as const, currency: undefined, updatedAt: "",
      }),
    },
    selfId: () => SELF,
    ...overrides,
  } as never);
}

function fakeMessage(content: string) {
  const replies: { content?: string; embeds?: unknown[] }[] = [];
  const message = {
    guildId: "guild-a",
    author: { id: "member-1", bot: false },
    webhookId: null,
    system: false,
    content,
    mentions: { has: () => true, users: { has: () => false } },
    reference: null,
    channel: { isThread: () => false, parentId: null },
    member: { permissions: { has: () => true } },
    reply: async (payload: { content?: string; embeds?: unknown[]; components?: unknown[] }) => void replies.push(payload),
  };
  return { message, replies };
}

describe("inline command parsing", () => {
  it("recognises each counterpart", () => {
    const m = (text: string) => text.replace("SELF", SELF);
    expect(parseInlineCommand(m("<@SELF> version"), SELF)).toEqual({ command: "version", argument: "" });
    expect(parseInlineCommand(m("<@SELF> settings"), SELF)).toEqual({ command: "settings", argument: "" });
    expect(parseInlineCommand(m("<@SELF> printings Pikachu"), SELF)).toEqual({ command: "printings", argument: "Pikachu" });
    expect(parseInlineCommand(m("<@SELF> set sv01"), SELF)).toEqual({ command: "set", argument: "sv01" });
    expect(parseInlineCommand(m("<@SELF> search stadium"), SELF)).toBeUndefined();
    expect(parseInlineCommand(m("<@SELF> version"), "other-bot")).toBeUndefined();
  });

  it("requires an argument for printings and set", () => {
    expect(parseInlineCommand(`<@${SELF}> printings`, SELF)).toBeUndefined();
    expect(parseInlineCommand(`<@${SELF}> set`, SELF)).toBeUndefined();
  });
});

describe("inline counterparts answer like their slash commands", () => {
  function embedText(payload: { embeds?: { data: { description?: string; title?: string; fields?: { name: string; value: string }[] } }[] }): string {
    const embed = payload.embeds?.[0]?.data;
    if (!embed) return "";
    if (embed.description) return embed.description;
    return (embed.fields ?? []).map((field) => `${field.name}: ${field.value}`).join("\n");
  }

  it("replies with the version embed", async () => {
    const { message, replies } = fakeMessage(`<@${SELF}> version`);
    await handler()(message as never);
    const text = embedText(replies[0] as never);
    expect(text).toContain("Running revision:");
    expect(text).toContain("Uptime:");
    expect(text).toContain("github.com/leonid-dalin/pokemon-tcg-card-bot/commit/");
  });

  it("replies with a temporary settings launcher", async () => {
    const { message, replies } = fakeMessage(`<@${SELF}> settings`);
    await handler()(message as never);
    const payload = replies[0] as { embeds?: (EmbedBuilder | { title?: string })[]; components?: { components: { data: { custom_id: string } }[] }[] };
    const embed = payload.embeds?.[0] as { data?: { title?: string }; title?: string } | undefined;
    expect(embed?.data?.title ?? embed?.title).toBe("Crustlebot settings");
    expect(payload.components?.[0]?.components[0]?.data.custom_id).toBe("st:launcher");
  });

  it("opens a private panel from the launcher button", async () => {
    const { SettingsPanelController } = await import("../src/discord/settings-controller.js");
    const { SettingsSessions } = await import("../src/discord/settings-session.js");
    const replies: { flags?: number }[] = [];
    const interaction = {
      user: { id: "member-1" },
      guildId: "guild-a",
      inGuild: () => true,
      memberPermissions: { has: () => true },
      reply: async (payload: never) => void replies.push(payload),
    };
    const store = {
      get: () => ({
        guildId: "guild-a", messageReplies: true, decklistReplies: false,
        autoReplyChannelMode: "all" as const, selectedChannelIds: [], cooldownSeconds: 0,
        cardGames: "both" as const, defaultCardGame: "ptcg" as const, currency: undefined, updatedAt: "",
      }),
      messageRepliesFor: () => undefined,
      currencyFor: () => undefined,
    };
    const controller = new SettingsPanelController(store as never, true, new SettingsSessions());
    await controller.openFromLauncher(interaction as never);
    expect(replies[0]?.flags).toBeDefined();
  });
});

describe("inline printings guards short and bang-prefixed names", () => {
  it.each([
    ["printings !n", "n"],
    ["printings N", "N"],
    ["printings !N", "N"],
  ])("answers %s with the too-short explanation", async (content, echoed) => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });
    const { message, replies } = fakeMessage(`<@${SELF}> ${content}`);
    await handler()(message as never);
    expect(replies[0]?.content).toBe(`No card matched \`${echoed}\`. A single letter is too little to search on.`);
    expect(calls).toEqual([]);
  });
});

describe("inline printings and set spend the member allowance", () => {
  it("answers busy without fetching when the member is spent", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    });
    const { message, replies } = fakeMessage(`<@${SELF}> printings Pikachu`);
    await handler({
      requests: { take: () => ({ allowed: false as const, retryAfterSeconds: 3 }) },
    })(message as never);
    expect(calls).toEqual([]);
    expect(replies[0]?.content).toBe("The card service is busy. Try again in 3 seconds.");
  });

  it("keeps a DM key separate from the guild key", async () => {
    const keys: string[] = [];
    const { message } = fakeMessage(`<@${SELF}> set sv01`);
    await handler({
      requests: { take: (key: string) => { keys.push(key); return { allowed: true as const }; } },
    })(message as never);
    expect(keys[0]).toBe("guild-a:member-1");
  });
});
