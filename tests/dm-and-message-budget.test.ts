import { afterEach, describe, expect, it, vi } from "vitest";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { MentionBudget } from "../src/cooldown.js";
import { busyMessage } from "../src/discord/interaction-failure.js";
import { handleAutocomplete, handleCardCommand } from "../src/discord/commands.js";
import { createMessageHandler } from "../src/discord/messages.js";

afterEach(() => vi.unstubAllGlobals());

const base = { attribution: "Card data from TCGdex", energyEmoji: {} };

describe("a direct message is metered too", () => {
  it("refuses a card lookup in a DM once the member's allowance is spent", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    });
    const requests = new MentionBudget({ capacity: 1, refillSeconds: 60 });
    const context = { ...base, client: new TcgdexClient({ retries: 0 }), requests };
    const sent: string[] = [];
    const interaction = {
      guildId: null,
      user: { id: "dm-member" },
      options: { getString: (name: string) => (name === "name" ? "Pikachu" : null), getBoolean: () => null },
      deferReply: async () => sent.push("defer"),
      editReply: async (payload: { content?: string }) => sent.push(`edit:${payload.content ?? ""}`),
    };

    await handleCardCommand(context as never, interaction as never);
    const afterFirst = calls.length;
    await handleCardCommand(context as never, interaction as never);

    expect(afterFirst).toBeGreaterThan(0);
    expect(calls.length).toBe(afterFirst);
    expect(sent.at(-1)).toBe(`edit:${busyMessage(60)}`);
  });

  it("keeps a DM key separate from the same member in a guild", async () => {
    const keys: string[] = [];
    const context = {
      ...base,
      client: new TcgdexClient({ retries: 0 }),
      requests: { take: (key: string) => { keys.push(key); return { allowed: true as const }; } },
    };
    const sent: string[] = [];
    const interaction = {
      guildId: "guild-a",
      user: { id: "member-1" },
      options: { getString: (name: string) => (name === "name" ? "Pikachu" : null), getBoolean: () => null },
      deferReply: async () => sent.push("defer"),
      editReply: async () => sent.push("edit"),
    };
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => [] }) as unknown as Response);

    await handleCardCommand(context as never, interaction as never);

    expect(keys).toEqual(["guild-a:member-1"]);
  });

  it("does not charge when no limiter is configured", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => [] }) as unknown as Response);
    const sent: string[] = [];
    const interaction = {
      guildId: null,
      user: { id: "dm-member" },
      options: { getString: (name: string) => (name === "name" ? "Pikachu" : null), getBoolean: () => null },
      deferReply: async () => sent.push("defer"),
      editReply: async () => sent.push("edit"),
    };
    const context = { ...base, client: new TcgdexClient({ retries: 0 }) };

    await expect(handleCardCommand(context as never, interaction as never)).resolves.toBeUndefined();
  });
});

describe("mention handling spends the same allowance", () => {
  function handler(requests: MentionBudget | undefined) {
    return createMessageHandler({
      api: new TcgdexClient({ retries: 0 }),
      config: { mentionEnabled: true, decklistEnabled: false, mentionCooldownSeconds: 0, attribution: "x", energyEmoji: {} },
      pages: { create: () => "p", get: () => undefined, set: () => undefined, delete: () => undefined } as never,
      requests,
      selfId: () => "bot",
    });
  }

  function fakeMessage() {
    const replies: { content?: string }[] = [];
    const message = {
      guildId: "guild-a",
      author: { id: "member-1", bot: false },
      webhookId: null,
      system: false,
      content: "[[Pikachu]]",
      mentions: { has: () => true, users: { has: () => false } },
      reference: null,
      reply: async (payload: { content?: string }) => void replies.push(payload),
    };
    return { message, replies };
  }

  it("answers busy without an upstream lookup when the member is spent", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    });
    const requests = new MentionBudget({ capacity: 1, refillSeconds: 60 });
    requests.take("guild-a:member-1");
    const { message, replies } = fakeMessage();

    await handler(requests)(message as never);

    expect(calls).toEqual([]);
    expect(replies[0]?.content).toBe(busyMessage(60));
  });

  it("looks the card up when the member has allowance", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    });
    const requests = new MentionBudget({ capacity: 2, refillSeconds: 60 });
    const { message, replies } = fakeMessage();

    await handler(requests)(message as never);

    expect(calls.length).toBeGreaterThan(0);
    expect(replies[0]?.content).not.toBe(busyMessage(60));
  });
});
