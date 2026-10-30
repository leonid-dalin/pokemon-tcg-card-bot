import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageFlags, type EmbedBuilder } from "discord.js";
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
    id: "invoke-1",
    author: { id: "member-1", bot: false },
    webhookId: null,
    system: false,
    content,
    mentions: { has: () => true, users: { has: () => false } },
    reference: null,
    channel: { isThread: () => false, parentId: null },
    member: { permissions: { has: () => true } },
    reply: async (payload: { content?: string; embeds?: unknown[]; components?: unknown[] }) => {
      replies.push(payload);
      return { id: "reply-1" };
    },
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
    const deferrals: { flags?: number }[] = [];
    const replies: { flags?: number }[] = [];
    const interaction = {
      user: { id: "member-1" },
      guildId: "guild-a",
      inGuild: () => true,
      memberPermissions: { has: () => true },
      deferReply: async (options: { flags?: number }) => void deferrals.push(options ?? {}),
      editReply: async (payload: never) => void replies.push(payload),
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
    // The panel is deferred as private, then edited in as a follow-up: an initial
    // ephemeral response carrying the V2 flag is stored but renders blank.
    expect(deferrals[0]?.flags).toBe(MessageFlags.Ephemeral);
    const flags = replies[0]?.flags ?? 0;
    expect(flags & MessageFlags.IsComponentsV2).toBe(MessageFlags.IsComponentsV2);
    expect(flags & MessageFlags.Ephemeral).toBe(0);
  });

  it("opens a private panel in a direct message", async () => {
    const { SettingsPanelController } = await import("../src/discord/settings-controller.js");
    const { SettingsSessions } = await import("../src/discord/settings-session.js");
    const deferrals: { flags?: number }[] = [];
    const replies: { flags?: number }[] = [];
    const interaction = {
      user: { id: "member-1" },
      guildId: null,
      inGuild: () => false,
      memberPermissions: null,
      deferReply: async (options: { flags?: number }) => void deferrals.push(options ?? {}),
      editReply: async (payload: never) => void replies.push(payload),
      update: async () => undefined,
    };
    const store = {
      get: () => undefined,
      messageRepliesFor: () => undefined,
      currencyFor: () => undefined,
    };
    const controller = new SettingsPanelController(store as never, true, new SettingsSessions());
    await controller.openForCommand(interaction as never);
    expect(replies[0]?.flags).toBeDefined();
  });
});

describe("inline printings guards short strings that name no card", () => {
  it.each([
    ["printings q", "q"],
    ["printings !q", "q"],
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

  it.each(["printings N", "printings !N"])("lists the printings of %s", async (content) => {
    // The upstream name search cannot reach "N" inside its result cap, so the
    // index supplies the ids and the API only fills in the summaries.
    const responses: Record<string, unknown> = {
      "/cards?name=N": [],
      "/cards/xy10-105a": { id: "xy10-105a", localId: "105a", name: "N" },
    };
    vi.stubGlobal("fetch", async (url: string) => {
      const path = String(url).replace(/^https?:\/\/[^/]+\/(v2\/)?/, "/").replace(/^\/en/, "");
      const body = responses[path];
      if (body === undefined) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    });
    const { message, replies } = fakeMessage(`<@${SELF}> ${content}`);
    await handler({ mentionEnabled: true })(message as never);
    const text = JSON.stringify(replies[0] ?? {});
    expect(text).not.toContain("single letter is too little");
    expect(text).toContain("N");
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

describe("inline cleanup scope", () => {
  function cleanupFixture() {
    const scheduled: string[] = [];
    const recorded: string[] = [];
    return {
      scheduled,
      recorded,
      context: {
        cleanup: { schedule: (job: { botMessageId: string }) => void scheduled.push(job.botMessageId) },
        invocations: { record: () => void recorded.push("entry") },
      },
    };
  }

  it("schedules cleanup for a settings launcher only", async () => {
    const fixture = cleanupFixture();
    const { message } = fakeMessage(`<@${SELF}> settings`);
    await handler(fixture.context as never)(message as never);
    expect(fixture.scheduled).toHaveLength(1);
    expect(fixture.recorded).toHaveLength(1);
  });

  it("schedules cleanup for a version exchange", async () => {
    const fixture = cleanupFixture();
    const { message } = fakeMessage(`<@${SELF}> version`);
    await handler(fixture.context as never)(message as never);
    expect(fixture.scheduled).toHaveLength(1);
    expect(fixture.recorded).toHaveLength(1);
  });

  it("leaves a card list readable", async () => {
    const fixture = cleanupFixture();
    const { message } = fakeMessage(`<@${SELF}> printings Dragapult ex`);
    await handler(fixture.context as never)(message as never);
    expect(fixture.scheduled).toHaveLength(0);
  });
});

describe("short names that are real cards", () => {
  it("finds the card N by its exact name", async () => {
    const { findExactCardName } = await import("../src/text-search.js");
    expect(findExactCardName("N")?.name).toBe("N");
    expect(findExactCardName("n")?.name).toBe("N");
  });

  it("returns nothing for a short string that names no card", async () => {
    const { findExactCardName } = await import("../src/text-search.js");
    expect(findExactCardName("q")).toBeUndefined();
    expect(findExactCardName("zz")).toBeUndefined();
  });

  it("does not answer N with the single-letter refusal", async () => {
    const replies: { content?: string }[] = [];
    const message = {
      guildId: "guild-a", id: "invoke-n", author: { id: "member-1", bot: false },
      webhookId: null, system: false, content: `<@${SELF}> printings N`,
      mentions: { has: () => true, users: { has: () => false } },
      reference: null, channel: { isThread: () => false, parentId: null },
      member: { permissions: { has: () => true } },
      reply: async (payload: { content?: string }) => { replies.push(payload); return { id: "r" }; },
    };
    const context = {
      api: { searchByName: async () => [], getCard: async () => undefined },
      pages: undefined,
      config: { attribution: "", energyEmoji: {}, mentionCooldownSeconds: 0 },
      settings: undefined,
      requests: undefined,
    };
    await handler(context as never)(message as never);
    const text = (replies[0]?.content ?? "").toString();
    expect(text).not.toContain("single letter is too little");
  });
});
