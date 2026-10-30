import { ChannelType } from "discord.js";
import { describe, expect, it } from "vitest";
import { CleanupWorker } from "../src/discord/cleanup-worker.js";

function channel(deletions: string[], options: { dm?: boolean; deleteRejects?: boolean; missing?: boolean } = {}) {
  return {
    type: options.dm ? ChannelType.DM : ChannelType.GuildText,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    messages: {
      fetch: async (messageId: string) => {
        if (options.missing) throw new Error("Unknown Message");
        return {
          delete: async () => {
            if (options.deleteRejects) throw new Error("Missing Permissions");
            deletions.push(messageId);
          },
        };
      },
    },
  };
}

const JOB = { messageId: "reply-1", channelId: "channel-1", invokeMessageId: "invoke-1", deleteAfter: 0 };

function workerFor(channelValue: unknown, store: { completeCleanup: (id: string) => void }) {
  const client = { user: { id: "bot" }, channels: { fetch: async () => channelValue } };
  return new CleanupWorker(client as never, { dueCleanup: () => [JOB], ...store } as never);
}

describe("cleanup worker", () => {
  it("deletes the reply and the invoking message, then completes the job", async () => {
    const deletions: string[] = [];
    const completed: string[] = [];
    const worker = workerFor(channel(deletions), { completeCleanup: (id) => void completed.push(id) });
    await worker.drain();
    expect(deletions).toEqual(["reply-1", "invoke-1"]);
    expect(completed).toEqual(["reply-1"]);
  });

  it("keeps the job when a deletion fails so the next drain retries", async () => {
    const completed: string[] = [];
    const worker = workerFor(channel([], { deleteRejects: true }), { completeCleanup: (id) => void completed.push(id) });
    await worker.drain();
    expect(completed).toEqual([]);
  });

  it("completes the job when the messages are already gone", async () => {
    const completed: string[] = [];
    const worker = workerFor(channel([], { missing: true }), { completeCleanup: (id) => void completed.push(id) });
    await worker.drain();
    expect(completed).toEqual(["reply-1"]);
  });

  it("deletes the bot reply in a direct message", async () => {
    const deletions: string[] = [];
    const completed: string[] = [];
    const worker = workerFor(channel(deletions, { dm: true }), { completeCleanup: (id) => void completed.push(id) });
    await worker.drain();
    expect(deletions).toEqual(["reply-1", "invoke-1"]);
    expect(completed).toEqual(["reply-1"]);
  });
});
