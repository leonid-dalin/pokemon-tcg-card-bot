import { afterEach, describe, expect, it, vi } from "vitest";
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
  function embedText(payload: { embeds?: { data: { description?: string; title?: string } }[] }): string {
    return payload.embeds?.[0]?.data.description ?? "";
  }

  it("replies with the version embed", async () => {
    const { message, replies } = fakeMessage(`<@${SELF}> version`);
    await handler()(message as never);
    const text = embedText(replies[0] as never);
    expect(text).toContain("Revision:");
    expect(text).toContain("Uptime:");
  });

  it("replies with the settings embed and its toggle buttons", async () => {
    const { message, replies } = fakeMessage(`<@${SELF}> settings`);
    await handler()(message as never);
    const text = embedText(replies[0] as never);
    expect(text).toContain("Message replies: on");
    expect(text).toContain("Card games:");
    const row = (replies[0] as { components?: { components: { data: { custom_id: string } }[] }[] }).components?.[0];
    expect(row?.components.map((button) => button.data.custom_id)).toEqual(["iset:messages", "iset:decklists"]);
  });

  it("applies a settings toggle from its button and re-renders the view", async () => {
    const { handleInlineSettingsButton } = await import("../src/discord/settings-command.js");
    const applied: unknown[] = [];
    const settings = {
      get: () => ({
        guildId: "guild-a", messageReplies: true, decklistReplies: false,
        autoReplyChannelMode: "all" as const, selectedChannelIds: [], cooldownSeconds: 0,
        cardGames: "both" as const, defaultCardGame: "ptcg" as const, currency: undefined, updatedAt: "",
      }),
      update: (guildId: string, patch: Record<string, unknown>) => void applied.push(patch),
    };
    const updates: { embeds?: { data: { description?: string } }[]; components?: { components: { data: { label: string } }[] }[] }[] = [];
    const interaction = {
      guildId: "guild-a",
      customId: "iset:messages",
      inGuild: () => true,
      memberPermissions: { has: () => true },
      deferUpdate: async () => undefined,
      editReply: async (payload: never) => void updates.push(payload),
      followUp: async () => undefined,
    };

    await handleInlineSettingsButton({ settings: settings as never, mentionEnabled: true }, interaction as never);

    expect(applied).toEqual([{ messageReplies: false }]);
    const text = updates[0]?.embeds?.[0]?.data.description ?? "";
    expect(text).toContain("Message replies: off");
    expect(updates[0]?.components?.[0]?.components[0]?.data.label).toBe("Message replies: off");
  });

  it("reports a failed save without re-rendering the view", async () => {
    const { handleInlineSettingsButton } = await import("../src/discord/settings-command.js");
    const settings = {
      get: () => ({ messageReplies: true, decklistReplies: false }),
      update: () => { throw new Error("database is locked"); },
    };
    const updates: unknown[] = [];
    const followUps: { content?: string; flags?: number }[] = [];
    const interaction = {
      guildId: "guild-a",
      customId: "iset:messages",
      inGuild: () => true,
      memberPermissions: { has: () => true },
      deferUpdate: async () => undefined,
      editReply: async (payload: never) => void updates.push(payload),
      followUp: async (payload: never) => void followUps.push(payload),
    };

    await handleInlineSettingsButton({ settings: settings as never, mentionEnabled: true }, interaction as never);

    expect(updates).toEqual([]);
    expect(followUps[0]?.content).toContain("Could not save that change");
  });

  it("confirms a saved change privately when the view refresh fails", async () => {
    const { handleInlineSettingsButton } = await import("../src/discord/settings-command.js");
    const settings = {
      get: () => ({ messageReplies: true, decklistReplies: false }),
      update: () => undefined,
    };
    const updates: unknown[] = [];
    const followUps: { content?: string }[] = [];
    const interaction = {
      guildId: "guild-a",
      customId: "iset:messages",
      inGuild: () => true,
      memberPermissions: { has: () => true },
      deferUpdate: async () => undefined,
      editReply: async () => { throw new Error("discord rejected the edit"); },
      followUp: async (payload: { content?: string }) => void followUps.push(payload),
    };

    await handleInlineSettingsButton({ settings: settings as never, mentionEnabled: true }, interaction as never);

    expect(updates).toEqual([]);
    expect(followUps[0]?.content).toContain("Saved: Message replies is now off");
    expect(followUps[0]?.content).toContain("/settings view");
  });

  it("refuses a settings toggle from a member without Manage Server", async () => {
    const { handleInlineSettingsButton } = await import("../src/discord/settings-command.js");
    const settings = { get: () => ({ messageReplies: true }), update: () => undefined };
    const replies: { content?: string }[] = [];
    const interaction = {
      guildId: "guild-a",
      customId: "iset:messages",
      inGuild: () => true,
      memberPermissions: { has: () => false },
      reply: async (payload: { content?: string }) => void replies.push(payload),
      update: async () => undefined,
    };

    await handleInlineSettingsButton({ settings: settings as never, mentionEnabled: true }, interaction as never);

    expect(replies[0]?.content).toContain("Manage Server");
  });

  it("lists printings for a name", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (!String(url).includes("/cards?name=")) {
        return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => [{ id: "sv01-025", name: "Pikachu" }] } as unknown as Response;
    });
    const { message, replies } = fakeMessage(`<@${SELF}> printings Pikachu`);
    await handler()(message as never);
    expect(replies[0]?.embeds?.length ?? 0).toBeGreaterThan(0);
  });

  it("shows a set", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (!String(url).includes("/sets/sv01")) {
        return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "sv01", name: "Scarlet & Violet", releaseDate: "2023-03-31", cards: [] }),
      } as unknown as Response;
    });
    const { message, replies } = fakeMessage(`<@${SELF}> set sv01`);
    await handler()(message as never);
    expect(replies[0]?.embeds?.length ?? 0).toBeGreaterThan(0);
  });

  it("reports a missing set without claiming an outage", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response);
    const { message, replies } = fakeMessage(`<@${SELF}> set nope-9`);
    await handler()(message as never);
    expect(replies[0]?.content).toContain("No set matched");
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
