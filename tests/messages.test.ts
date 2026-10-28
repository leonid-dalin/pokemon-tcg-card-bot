import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import type { Card, CardSummary } from "../src/api/types.js";
import { MentionBudget } from "../src/cooldown.js";
import { PageStore } from "../src/discord/pages.js";
import { createMessageHandler, type IncomingMessage, type MessageContext } from "../src/discord/messages.js";

const dragapult = JSON.parse(
  readFileSync(new URL("./fixtures/dragapult-ex-sv08.5-073.json", import.meta.url), "utf8"),
) as Card;

const BOT_ID = "999";

/** A client that knows two Dragapult ex printings and fails on demand. */
function fakeApi(options: { failSearch?: boolean } = {}): TcgdexClient {
  const summaries: CardSummary[] = [
    { id: "sv08.5-073", name: "Dragapult ex", localId: "073" },
    { id: "sv06-130", name: "Dragapult ex", localId: "130" },
  ];
  return {
    searchByName: async (name: string) => {
      if (options.failSearch) throw new Error("upstream 503");
      return summaries.filter((card) => card.name.toLowerCase().includes(name.toLowerCase()));
    },
    getCard: async (id: string) => ({ ...dragapult, id }),
  } as unknown as TcgdexClient;
}

function fakeMessage(
  content: string,
  overrides: Partial<{ bot: boolean; webhookId: string | null; system: boolean; author: string; guildId: string; member: unknown; channelId: string; channel: unknown }> = {},
) {
  const replies: Record<string, unknown>[] = [];
  const message = {
    author: { bot: overrides.bot ?? false, id: overrides.author ?? "1", username: "tester" },
    webhookId: overrides.webhookId ?? null,
    system: overrides.system ?? false,
    content,
    attachments: { size: 0 },
    embeds: [],
    stickers: { size: 0 },
    channelId: overrides.channelId ?? "c",
    guildId: overrides.guildId,
    member: overrides.member,
    channel: overrides.channel,
    reply: async (payload: Record<string, unknown>) => {
      replies.push(payload);
      return {};
    },
  };
  return { message: message as unknown as IncomingMessage, replies };
}

function handler(overrides: Partial<MessageContext> = {}, config: Partial<MessageContext["config"]> = {}) {
  return createMessageHandler({
    api: fakeApi(),
    config: { mentionEnabled: true, decklistEnabled: false, mentionCooldownSeconds: 0, attribution: "Card data from TCGdex", energyEmoji: {}, ...config },
    pages: new PageStore(),
    selfId: () => BOT_ID,
    ...overrides,
  });
}

const DECK = ["Pokémon: 2", "4 Dreepy TWM 128", "3 Drakloak TWM 129", "Trainer: 3", "4 Iono PAL 185", "4 Ultra Ball SVI 196", "Energy: 1", "8 Basic Psychic Energy"].join("\n");

afterEach(() => vi.restoreAllMocks());

describe("message handler", () => {
  it.each([
    ["a bot", { bot: true }],
    ["a webhook", { webhookId: "w" }],
    ["a system message", { system: true }],
  ])("ignores %s", async (_label, overrides) => {
    const { message, replies } = fakeMessage("[[Dragapult ex]]", overrides);
    await handler()(message);
    expect(replies).toEqual([]);
  });

  it("stays quiet when mention replies are off", async () => {
    const { message, replies } = fakeMessage("[[Dragapult ex]]");
    await handler({}, { mentionEnabled: false })(message);
    expect(replies).toEqual([]);
  });

  it("answers a mention with the card and its printing buttons", async () => {
    const { message, replies } = fakeMessage("look at [[Dragapult ex]]");
    await handler()(message);
    expect(replies).toHaveLength(1);
    const reply = replies[0] as { embeds: unknown[]; components: unknown[] };
    expect(reply.embeds).toHaveLength(1);
    expect(reply.components).toHaveLength(2);
    // An allowedMentions override replaces the client's default mention restrictions.
    expect(replies.every((payload) => !("allowedMentions" in payload))).toBe(true);
  });

  it("answers a bare mention with the help card", async () => {
    const { message, replies } = fakeMessage(`<@${BOT_ID}>`);
    await handler()(message);
    expect(replies).toHaveLength(1);
    const embed = (replies[0]?.embeds as { data: { title?: string; fields?: unknown[] } }[])[0]?.data;
    expect(embed?.title).toBe("Pokémon TCG card bot");
    expect(embed?.fields?.length).toBe(3);
  });

  it("answers the word help after a mention", async () => {
    const { message, replies } = fakeMessage(`<@${BOT_ID}> help`);
    await handler()(message);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.content).toBeUndefined();
  });

  it("lets a mention search win over help", async () => {
    const { message, replies } = fakeMessage(`<@${BOT_ID}> search draw 2 cards`);
    await handler()(message);
    expect(replies[0]?.embeds).toHaveLength(1);
    const title = (replies[0]?.embeds as { data: { title?: string } }[])[0]?.data.title;
    expect(title).toMatch(/^\d+ cards mention "draw 2 cards"$/);
  });

  it("stays quiet when a mention asks something it cannot answer", async () => {
    const { message, replies } = fakeMessage(`<@${BOT_ID}> which deck is best`);
    await handler()(message);
    expect(replies).toEqual([]);
  });

  it("answers a miss with the closest names in a menu", async () => {
    const { message, replies } = fakeMessage("[[Dragapult zzz]]");
    await handler()(message);
    expect(replies[0]?.content).toBe("No card matched `Dragapult zzz`. Pick the closest below.");
    const components = (replies[0] as { components: { toJSON: () => unknown }[] }).components;
    expect(components).toHaveLength(1);
    const menu = components[0]!.toJSON() as { components: { options: { label: string; value: string }[] }[] };
    expect(menu.components[0]?.options.map((option) => option.value)).toEqual(["sv08.5-073", "sv06-130"]);
    expect(menu.components[0]?.options[0]?.label).toBe("Dragapult ex · PRE 73");
  });

  it("answers an image-only mention with the scan alone", async () => {
    const { message, replies } = fakeMessage("[[!Dragapult ex]]");
    await handler()(message);
    expect(replies).toHaveLength(1);
    const reply = replies[0] as { embeds: { data: { fields?: unknown[]; image?: { url: string } }[] }[]; components?: unknown[] };
    expect(reply.embeds).toHaveLength(1);
    expect(reply.embeds[0]?.data.fields).toBeUndefined();
    expect(reply.embeds[0]?.data.image?.url).toBe("https://assets.tcgdex.net/en/sv/sv08.5/073/high.webp");
    expect(reply.components).toBeUndefined();
  });

  it("reports a failed lookup instead of staying silent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { message, replies } = fakeMessage("[[Dragapult ex]]");
    await handler({ api: fakeApi({ failSearch: true }) })(message);
    expect(replies[0]?.content).toBe("Card lookup failed, try again in a moment.");
  });

  it("answers @bot search from the local index", async () => {
    const { message, replies } = fakeMessage(`<@${BOT_ID}> search draw 2 cards`);
    await handler()(message);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.embeds).toHaveLength(1);
    // Pages, the category filter and the open-a-card menu.
    expect(replies[0]?.components).toHaveLength(3);
  });

  it("asks for search words when none were given", async () => {
    const { message, replies } = fakeMessage(`<@${BOT_ID}> search`);
    await handler()(message);
    expect(replies[0]?.content).toBe("Add what to look for after search, for example: search stadium.");
  });

  it("formats a pasted decklist only when decklists are on", async () => {
    const off = fakeMessage(DECK);
    await handler()(off.message);
    expect(off.replies).toEqual([]);

    const on = fakeMessage(DECK);
    await handler({}, { decklistEnabled: true })(on.message);
    expect(on.replies).toHaveLength(1);
  });

  it("throttles a member who mentions too often", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const handle = handler({ budget: new MentionBudget({ capacity: 1, refillSeconds: 60 }) });
    const first = fakeMessage("[[Dragapult ex]]");
    const second = fakeMessage("[[Dragapult ex]]");
    await handle(first.message);
    await handle(second.message);
    expect(first.replies).toHaveLength(1);
    expect(second.replies).toEqual([]);
  });

  it.each([
    ["an @bot search", `<@${BOT_ID}> search draw 2 cards`, {}],
    ["a pasted decklist", DECK, { decklistEnabled: true }],
  ])("throttles %s on the same budget as mentions", async (_label, content, config) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const handle = handler({ budget: new MentionBudget({ capacity: 1, refillSeconds: 60 }) }, config);
    const first = fakeMessage(content);
    const second = fakeMessage("[[Dragapult ex]]");
    await handle(first.message);
    await handle(second.message);
    expect(first.replies).toHaveLength(1);
    expect(second.replies).toEqual([]);
  });

  it("spends no budget on a message it does not answer", async () => {
    const handle = handler({ budget: new MentionBudget({ capacity: 1, refillSeconds: 60 }) });
    await handle(fakeMessage("just chatting").message);
    const mention = fakeMessage("[[Dragapult ex]]");
    await handle(mention.message);
    expect(mention.replies).toHaveLength(1);
  });

  it("warns once when message text arrives empty", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handle = handler();
    await handle(fakeMessage("").message);
    await handle(fakeMessage("").message);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("records the invocation without any user identifier", async () => {
    const recorded: Record<string, unknown>[] = [];
    const { message } = fakeMessage("[[Dragapult ex]]", { guildId: "g1" });
    await handler({ invocations: { record: (entry) => recorded.push(entry) } })(message);
    expect(recorded).toHaveLength(1);
    const entry = recorded[0] as Record<string, unknown>;
    expect(entry).toMatchObject({ guildId: "g1", channelId: "c", trigger: "[[Dragapult ex]]", isAdmin: false });
    expect(Object.keys(entry)).not.toContain("userId");
    expect(Object.keys(entry)).not.toContain("username");
    expect(JSON.stringify(entry)).not.toContain("tester");
  });

  it("records whether the invoker is a server administrator", async () => {
    const recorded: Record<string, unknown>[] = [];
    const member = { permissions: { has: (flag: string) => flag === "ManageGuild" } };
    const admin = fakeMessage("[[Dragapult ex]]", { member });
    await handler({ invocations: { record: (entry) => recorded.push(entry) } })(admin.message);
    const ordinary = fakeMessage("[[Dragapult ex]]");
    await handler({ invocations: { record: (entry) => recorded.push(entry) } })(ordinary.message);
    expect(recorded.map((entry) => entry.isAdmin)).toEqual([true, false]);
  });

  it("keeps usernames and message text out of the runtime logs", async () => {
    const logs: string[] = [];
    for (const method of ["log", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => logs.push(args.join(" ")));
    }
    const handle = handler({ budget: new MentionBudget({ capacity: 1, refillSeconds: 60 }) });
    const first = fakeMessage("secret phrase [[Dragapult ex]]");
    const second = fakeMessage("secret phrase [[Dragapult ex]]");
    await handle(first.message);
    await handle(second.message);
    const failing = fakeMessage("[[Dragapult ex]]");
    await handler({ api: fakeApi({ failSearch: true }) })(failing.message);
    const printed = logs.join("\n");
    expect(printed).not.toContain("tester");
    expect(printed).not.toContain("secret phrase");
    expect(printed).toContain("skipped a reply");
    expect(printed).toMatch(/mention lookup failed \(\w+\)/);
  });

  it("redacts user-mention tokens from the recorded invocation", async () => {
    const recorded: Record<string, unknown>[] = [];
    const { message } = fakeMessage(`<@123> look at [[Dragapult ex]]`, { guildId: "g1" });
    await handler({ invocations: { record: (entry) => recorded.push(entry) } })(message);
    const entry = JSON.stringify(recorded[0]);
    expect(entry).not.toContain("123");
    expect(entry).toContain("<@user>");
  });

  it("records nothing when the reply fails to send", async () => {
    const recorded: Record<string, unknown>[] = [];
    const replies: Record<string, unknown>[] = [];
    const message = {
      ...fakeMessage("[[Dragapult ex]]").message,
      reply: async (payload: Record<string, unknown>) => {
        replies.push(payload);
        throw new Error("discord rejected it");
      },
    } as unknown as IncomingMessage;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await handler({ invocations: { record: (entry) => recorded.push(entry) } })(message);
    expect(replies).toHaveLength(1);
    expect(recorded).toEqual([]);
  });

  it("applies per-guild reply switches over the deployment defaults", async () => {
    const settings = { get: (guildId: string) => ({ guildId, messageReplies: guildId !== "off", decklistReplies: guildId === "deckson", autoReplyChannelMode: "all" as const, selectedChannelIds: [], cooldownSeconds: 0, updatedAt: "" }) };
    const muted = fakeMessage("[[Dragapult ex]]", { guildId: "off" });
    await handler({ settings })(muted.message);
    expect(muted.replies).toEqual([]);

    const deckOn = fakeMessage(DECK, { guildId: "deckson" });
    await handler({ settings })(deckOn.message);
    expect(deckOn.replies).toHaveLength(1);

    const deckOff = fakeMessage(DECK, { guildId: "on" });
    await handler({ settings })(deckOff.message);
    expect(deckOff.replies).toEqual([]);
  });

  it("suppresses replies when the guild settings cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const settings = { get: () => { throw new Error("stored cooldown is corrupt"); } };
    const { message, replies } = fakeMessage("[[Dragapult ex]]", { guildId: "g1" });
    await handler({ settings })(message);
    expect(replies).toEqual([]);
  });

  it("gives two guilds different cooldowns in the same process", async () => {
    const settings = { get: (guildId: string) => ({ guildId, messageReplies: true, decklistReplies: false, autoReplyChannelMode: "all" as const, selectedChannelIds: [], cooldownSeconds: guildId === "strict" ? 60 : 0, updatedAt: "" }) };
    const handle = handler({ settings });
    const lax = ["l1", "l2", "l3", "l4"].map((id) => fakeMessage("[[Dragapult ex]]", { guildId: "lax", author: id }));
    const strict = ["s1", "s2", "s3", "s4"].map((id) => fakeMessage("[[Dragapult ex]]", { guildId: "strict", author: "s" }));
    for (const message of lax) await handle(message.message);
    for (const message of strict) await handle(message.message);
    expect(lax.map(({ replies }) => replies).map((r) => r.length)).toEqual([1, 1, 1, 1]);
    expect(strict.map(({ replies }) => replies).map((r) => r.length)).toEqual([1, 1, 1, 0]);
  });

  it("applies a cooldown change to the next message in both directions", async () => {
    let cooldown = 0;
    const settings = { get: (guildId: string) => ({ guildId, messageReplies: true, decklistReplies: false, autoReplyChannelMode: "all" as const, selectedChannelIds: [], cooldownSeconds: cooldown, updatedAt: "" }) };
    const handle = handler({ settings });
    const send = () => fakeMessage("[[Dragapult ex]]", { guildId: "g1", author: "same" });

    const before = [send(), send(), send(), send()];
    for (const message of before) await handle(message.message);
    expect(before.map(({ replies }) => replies.length)).toEqual([1, 1, 1, 1]);

    cooldown = 60;
    const after = [send(), send(), send(), send()];
    for (const message of after) await handle(message.message);
    expect(after.map(({ replies }) => replies.length)).toEqual([1, 1, 1, 0]);

    cooldown = 0;
    const restored = send();
    await handle(restored.message);
    expect(restored.replies).toHaveLength(1);
  });

  it("resolves deck cards from the guild override when the deployment default is off", async () => {
    let lookups = 0;
    const api = {
      searchByName: async (name: string) => [{ id: "sv08.5-073", name: "Dragapult ex", localId: "073" }],
      getCard: async (id: string) => {
        lookups += 1;
        return { ...dragapult, id };
      },
    } as unknown as TcgdexClient;
    const settings = { get: (guildId: string) => ({ guildId, messageReplies: true, decklistReplies: true, autoReplyChannelMode: "all" as const, selectedChannelIds: [], cooldownSeconds: 0, updatedAt: "" }) };
    const { message, replies } = fakeMessage(DECK, { guildId: "g1" });
    await handler({ api, settings })(message);
    expect(replies).toHaveLength(1);
    expect(lookups).toBeGreaterThan(0);
  });

  it("replies only in selected channels and threads follow their parent", async () => {
    const settings = { get: (guildId: string) => ({ guildId, messageReplies: true, decklistReplies: false, autoReplyChannelMode: "selected" as const, selectedChannelIds: ["c-ok"], cooldownSeconds: 0, updatedAt: "" }) };
    const handle = handler({ settings });

    const elsewhere = fakeMessage("[[Dragapult ex]]", { guildId: "g1", channelId: "c-other" });
    await handle(elsewhere.message);
    expect(elsewhere.replies).toEqual([]);

    const selected = fakeMessage("[[Dragapult ex]]", { guildId: "g1", channelId: "c-ok" });
    await handle(selected.message);
    expect(selected.replies).toHaveLength(1);

    const thread = fakeMessage("[[Dragapult ex]]", {
      guildId: "g1",
      channelId: "c-thread",
      channel: { isThread: () => true, parentId: "c-ok" },
    });
    await handle(thread.message);
    expect(thread.replies).toHaveLength(1);
  });

  it("treats an empty selected list as no automatic replies", async () => {
    const settings = { get: (guildId: string) => ({ guildId, messageReplies: true, decklistReplies: false, autoReplyChannelMode: "selected" as const, selectedChannelIds: [], cooldownSeconds: 0, updatedAt: "" }) };
    const { message, replies } = fakeMessage("[[Dragapult ex]]", { guildId: "g1" });
    await handler({ settings })(message);
    expect(replies).toEqual([]);
  });

  it("replies in every channel when the mode is all", async () => {
    const settings = { get: (guildId: string) => ({ guildId, messageReplies: true, decklistReplies: false, autoReplyChannelMode: "all" as const, selectedChannelIds: [], cooldownSeconds: 0, updatedAt: "" }) };
    const anywhere = fakeMessage("[[Dragapult ex]]", { guildId: "g1", channelId: "any" });
    await handler({ settings })(anywhere.message);
    expect(anywhere.replies).toHaveLength(1);
  });
});
