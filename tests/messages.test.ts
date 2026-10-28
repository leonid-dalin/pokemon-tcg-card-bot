import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import type { Card, CardSummary } from "../src/api/types.js";
import { MentionBudget } from "../src/cooldown.js";
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

function fakeMessage(content: string, overrides: Partial<{ bot: boolean; webhookId: string | null; system: boolean; author: string }> = {}) {
  const replies: Record<string, unknown>[] = [];
  const message = {
    author: { bot: overrides.bot ?? false, id: overrides.author ?? "1", username: "tester" },
    webhookId: overrides.webhookId ?? null,
    system: overrides.system ?? false,
    content,
    attachments: { size: 0 },
    embeds: [],
    stickers: { size: 0 },
    channelId: "c",
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
    config: { mentionEnabled: true, decklistEnabled: false, attribution: "Card data from TCGdex", ...config },
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
    expect(reply.components).toHaveLength(1);
    // A reply's own allowedMentions would replace the client default that
    // stops the bot pinging anyone.
    expect(replies.every((payload) => !("allowedMentions" in payload))).toBe(true);
  });

  it("answers a miss with the closest names", async () => {
    const { message, replies } = fakeMessage("[[Dragapult zzz]]");
    await handler()(message);
    expect(replies[0]?.content).toBe(
      "No card matched `Dragapult zzz`. Closest: `Dragapult ex` (sv08.5-073), `Dragapult ex` (sv06-130).",
    );
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
});
