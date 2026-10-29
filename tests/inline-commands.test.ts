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
    reply: async (payload: { content?: string; embeds?: unknown[] }) => void replies.push(payload),
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
  it("replies with the version lines", async () => {
    const { message, replies } = fakeMessage(`<@${SELF}> version`);
    await handler()(message as never);
    expect(replies[0]?.content).toContain("Revision:");
    expect(replies[0]?.content).toContain("Uptime:");
  });

  it("replies with the effective settings", async () => {
    const { message, replies } = fakeMessage(`<@${SELF}> settings`);
    await handler()(message as never);
    expect(replies[0]?.content).toContain("Message replies: on");
    expect(replies[0]?.content).toContain("Card games:");
  });

  it("lists printings for a name", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => [{ id: "sv01-025", name: "Pikachu" }],
    }) as unknown as Response);
    const { message, replies } = fakeMessage(`<@${SELF}> printings Pikachu`);
    await handler()(message as never);
    expect(replies[0]?.embeds?.length ?? 0).toBeGreaterThan(0);
  });

  it("shows a set", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "sv01", name: "Scarlet & Violet", releaseDate: "2023-03-31", cards: [] }),
    }) as unknown as Response);
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
