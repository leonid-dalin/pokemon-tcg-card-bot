import { readFileSync } from "node:fs";
import { ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TcgdexError, type TcgdexClient } from "../src/api/tcgdex.js";
import type { Card, CardSummary } from "../src/api/types.js";
import { handleOpenCardMenu } from "../src/discord/commands.js";
import { CleanupWorker, MISS_DELETE_AFTER_MS } from "../src/discord/cleanup-worker.js";
import { createMessageHandler, type IncomingMessage } from "../src/discord/messages.js";
import { PageStore } from "../src/discord/pages.js";

const dragapult = JSON.parse(readFileSync(new URL("./fixtures/dragapult-ex-sv08.5-073.json", import.meta.url), "utf8")) as Card;
const SUMMARIES: CardSummary[] = [
  { id: "sv08.5-073", name: "Dragapult ex", localId: "073" },
  { id: "sv06-130", name: "Dragapult ex", localId: "130" },
];

const api = {
  searchByName: async (name: string) => SUMMARIES.filter((card) => card.name.toLowerCase().includes(name.toLowerCase())),
  getCard: async (id: string) => {
    if (!SUMMARIES.some((card) => card.id === id)) throw new TcgdexError("not found", 404);
    return { ...dragapult, id };
  },
} as unknown as TcgdexClient;

function cleanupSpy() {
  const scheduled: { job: { botMessageId: string; channelId: string; invokeMessageId?: string }; after?: number }[] = [];
  const cancelled: string[] = [];
  return {
    scheduled,
    cancelled,
    schedule: (job: { botMessageId: string; channelId: string; invokeMessageId?: string }, after?: number) => void scheduled.push({ job, after }),
    cancel: (id: string) => void cancelled.push(id),
  };
}

async function mention(content: string, cleanup = cleanupSpy()) {
  const replies: Record<string, unknown>[] = [];
  const message = {
    author: { bot: false, id: "1", username: "tester" },
    webhookId: null,
    system: false,
    content,
    attachments: { size: 0 },
    embeds: [],
    stickers: { size: 0 },
    channelId: "c",
    reply: async (payload: Record<string, unknown>) => {
      replies.push(payload);
      return { id: `bot-${replies.length}` };
    },
  } as unknown as IncomingMessage;
  await createMessageHandler({
    api,
    config: { mentionEnabled: true, decklistEnabled: false, mentionCooldownSeconds: 0, attribution: "Card data from TCGdex", energyEmoji: {} },
    pages: new PageStore(),
    selfId: () => "999",
    cleanup,
  })(message);
  return { replies, cleanup };
}

const customIds = (payload: Record<string, unknown>) =>
  JSON.stringify(((payload.components as { toJSON: () => unknown }[] | undefined) ?? []).map((row) => row.toJSON()));

afterEach(() => vi.useRealTimers());

describe("a miss reply", () => {
  it("deletes itself after 60 seconds and leaves the member's message alone", async () => {
    const { replies, cleanup } = await mention("[[Dragapult zzz]]");
    expect(replies).toHaveLength(1);
    expect(replies[0]?.content).toBe("No card matched `Dragapult zzz`. Pick the closest below.");
    expect(cleanup.scheduled).toEqual([{ job: { botMessageId: "bot-1", channelId: "c" }, after: MISS_DELETE_AFTER_MS }]);
    expect(MISS_DELETE_AFTER_MS).toBe(60_000);
  });

  it("goes out separately from found cards, and only the miss is timed", async () => {
    const { replies, cleanup } = await mention("[[Dragapult ex]] [[Dragapult zzz]]");
    expect(replies).toHaveLength(2);
    expect(replies[0]?.content).toBeUndefined();
    expect(replies[0]?.embeds).toBeDefined();
    expect(replies[1]?.content).toBe("No card matched `Dragapult zzz`. Pick the closest below.");
    expect(cleanup.scheduled.map((entry) => entry.job.botMessageId)).toEqual(["bot-2"]);
  });
});

function pick(value: string) {
  const calls: string[] = [];
  const edits: Record<string, unknown>[] = [];
  const followUps: Record<string, unknown>[] = [];
  const interaction = {
    customId: "open:miss0",
    values: [value],
    message: { id: "bot-1" },
    channelId: "c",
    guildId: null,
    user: { id: "1" },
    deferUpdate: async () => void calls.push("deferUpdate"),
    deferReply: async () => void calls.push("deferReply"),
    reply: async () => void calls.push("reply"),
    editReply: async (payload: Record<string, unknown>) => void (calls.push("editReply"), edits.push(payload)),
    followUp: async (payload: Record<string, unknown>) => void (calls.push("followUp"), followUps.push(payload)),
  };
  return { interaction, calls, edits, followUps };
}

const commandContext = (cleanup: ReturnType<typeof cleanupSpy>) => ({
  client: api,
  attribution: "Card data from TCGdex",
  energyEmoji: {},
  pages: new PageStore(),
  cleanup,
});

describe("picking from a miss menu", () => {
  it("replaces the miss with the card in place and stops the deletion", async () => {
    const cleanup = cleanupSpy();
    const { interaction, calls, edits } = pick("sv08.5-073");
    await handleOpenCardMenu(commandContext(cleanup) as never, interaction as never);
    expect(calls).toEqual(["deferUpdate", "editReply"]);
    expect(cleanup.cancelled).toEqual(["bot-1"]);
    expect(cleanup.scheduled).toEqual([]);
    expect(edits[0]?.content).toBe("");
    expect(edits[0]?.embeds).toBeDefined();
    expect(customIds(edits[0]!)).not.toContain("open:miss");
  });

  it("keeps the miss and its timer when the picked card cannot be found", async () => {
    const cleanup = cleanupSpy();
    const { interaction, calls, followUps } = pick("sv01-999");
    await handleOpenCardMenu(commandContext(cleanup) as never, interaction as never);
    expect(calls).toEqual(["deferUpdate", "followUp"]);
    expect(followUps[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(cleanup.cancelled).toEqual(["bot-1"]);
    expect(cleanup.scheduled).toEqual([{ job: { botMessageId: "bot-1", channelId: "c" }, after: MISS_DELETE_AFTER_MS }]);
  });
});

describe("cleanup worker for a bot-only job", () => {
  it("stores no member message and deletes only the reply", async () => {
    const stored: { invokeMessageId: string; deleteAfter: number }[] = [];
    const deletions: string[] = [];
    const completed: string[] = [];
    const store = {
      scheduleCleanup: (job: { invokeMessageId: string; deleteAfter: number }) => void stored.push(job),
      dueCleanup: () => [{ messageId: "reply-1", channelId: "c", invokeMessageId: "", deleteAfter: 0, attempts: 0 }],
      nextCleanupAt: () => undefined,
      completeCleanup: (id: string) => void completed.push(id),
      deferCleanup: () => undefined,
    };
    const channel = {
      type: ChannelType.GuildText,
      isTextBased: () => true,
      // No Manage Messages: a member-message deletion would fail the job.
      permissionsFor: () => ({ has: (flag: bigint) => flag !== PermissionFlagsBits.ManageMessages }),
      messages: { fetch: async (id: string) => ({ delete: async () => void deletions.push(id) }) },
    };
    const worker = new CleanupWorker({ user: { id: "bot" }, channels: { fetch: async () => channel } } as never, store as never);
    vi.useFakeTimers({ now: 1_000 });
    worker.schedule({ botMessageId: "reply-1", channelId: "c" }, MISS_DELETE_AFTER_MS);
    worker.stop();
    expect(stored).toEqual([expect.objectContaining({ invokeMessageId: "", deleteAfter: 61_000 })]);
    await worker.drain();
    expect(deletions).toEqual(["reply-1"]);
    expect(completed).toEqual(["reply-1"]);
  });

  it("cancels a pending deletion", () => {
    const completed: string[] = [];
    const worker = new CleanupWorker({} as never, { completeCleanup: (id: string) => void completed.push(id) } as never);
    worker.cancel("reply-1");
    expect(completed).toEqual(["reply-1"]);
  });
});
