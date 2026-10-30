import { ChannelType } from "discord.js";
import { describe, expect, it } from "vitest";
import { CleanupWorker } from "../src/discord/cleanup-worker.js";

const JOB = { messageId: "reply-1", channelId: "channel-1", invokeMessageId: "invoke-1", deleteAfter: 0, attempts: 0 };

function channel(
  deletions: string[],
  options: {
    dm?: boolean;
    reject?: (messageId: string) => unknown;
    missing?: boolean;
    gone?: boolean;
    denied?: string[];
  } = {},
) {
  return {
    type: options.dm ? ChannelType.DM : ChannelType.GuildText,
    isTextBased: () => true,
    permissionsFor: () => ({ has: (flag: bigint) => !(options.denied ?? []).includes(String(flag)) }),
    messages: {
      fetch: async (messageId: string) => {
        if (options.gone) throw { code: 10008 };
        if (options.missing) return undefined;
        return {
          delete: async () => {
            const rejection = options.reject?.(messageId);
            if (rejection) throw rejection;
            deletions.push(messageId);
          },
        };
      },
    },
  };
}

function workerFor(channelValue: unknown) {
  const completed: string[] = [];
  const deferred: { messageId: string; at: number; attempts: number }[] = [];
  let attempts = 0;
  const store = {
    dueCleanup: () => [{ ...JOB, attempts }],
    completeCleanup: (id: string) => void completed.push(id),
    deferCleanup: (id: string, at: number) => void deferred.push({ messageId: id, at, attempts }),
  };
  const client = { user: { id: "bot" }, channels: { fetch: async () => channelValue } };
  const worker = new CleanupWorker(client as never, store as never);
  return { worker, completed, deferred, setAttempts: (n: number) => void (attempts = n) };
}

describe("cleanup worker", () => {
  it("deletes the reply and the invoking message, then completes the job", async () => {
    const deletions: string[] = [];
    const { worker, completed } = workerFor(channel(deletions));
    await worker.drain();
    expect(deletions).toEqual(["reply-1", "invoke-1"]);
    expect(completed).toEqual(["reply-1"]);
  });

  it("keeps the job when a deletion fails so the next drain retries", async () => {
    const { worker, completed, deferred } = workerFor(channel([], { reject: () => new Error("Missing Permissions") }));
    await worker.drain();
    expect(completed).toEqual([]);
    expect(deferred).toHaveLength(1);
  });

  it("backfills the retry with a growing delay", async () => {
    const { worker, deferred, setAttempts } = workerFor(channel([], { reject: () => new Error("boom") }));
    setAttempts(2);
    await worker.drain();
    expect(deferred[0]!.at).toBeGreaterThan(Date.now() + 100_000);
  });

  it("drops a job that has exhausted its attempts", async () => {
    const { worker, completed, deferred, setAttempts } = workerFor(channel([], { reject: () => new Error("boom") }));
    setAttempts(5);
    await worker.drain();
    expect(completed).toEqual(["reply-1"]);
    expect(deferred).toEqual([]);
  });

  it("completes the job when the messages are already gone", async () => {
    const { worker, completed } = workerFor(channel([], { missing: true }));
    await worker.drain();
    expect(completed).toEqual(["reply-1"]);
  });

  it("treats a Discord gone code as absent rather than a failure", async () => {
    const { worker, completed, deferred } = workerFor(channel([], { gone: true }));
    await worker.drain();
    expect(completed).toEqual(["reply-1"]);
    expect(deferred).toEqual([]);
  });

  it("deletes only the bot reply in a direct message", async () => {
    const deletions: string[] = [];
    const { worker, completed } = workerFor(channel(deletions, { dm: true }));
    await worker.drain();
    expect(deletions).toEqual(["reply-1"]);
    expect(completed).toEqual(["reply-1"]);
  });

  it("retries when only the invoking message fails", async () => {
    const deletions: string[] = [];
    const { worker, completed, deferred } = workerFor(
      channel(deletions, { reject: (id) => (id === "invoke-1" ? new Error("forbidden") : undefined) }),
    );
    await worker.drain();
    expect(deletions).toEqual(["reply-1"]);
    expect(completed).toEqual([]);
    expect(deferred).toHaveLength(1);
  });
});

describe("cleanup worker permission handling", () => {
  it("keeps the job when Manage Messages is missing", async () => {
    // 8192 is Manage Messages: the member's own command cannot be removed.
    const value = channel([], { denied: ["8192"] });
    const fx = workerFor(value);
    await fx.worker.drain();
    expect(fx.completed).toEqual([]);
    expect(fx.deferred).toHaveLength(1);
  });

  it("keeps the job when the bot cannot view the channel", async () => {
    // 1024 is View Channel.
    const value = channel([], { denied: ["1024"] });
    const fx = workerFor(value);
    await fx.worker.drain();
    expect(fx.completed).toEqual([]);
    expect(fx.deferred).toHaveLength(1);
  });

  it("treats a missing-access error as retryable", async () => {
    const value = channel([], { reject: () => ({ code: 50001 }) });
    const fx = workerFor(value);
    await fx.worker.drain();
    expect(fx.completed).toEqual([]);
    expect(fx.deferred).toHaveLength(1);
  });
});

describe("cleanup worker scheduling", () => {
  it("drains at the job deadline instead of waiting for a poll tick", async () => {
    // A job scheduled just after a tick must not wait a whole extra interval.
    const deletions: string[] = [];
    const scheduled: number[] = [];
    const completed: string[] = [];
    type Job = typeof JOB & { deleteAfter: number };
    let due: Job[] = [];
    const store = {
      scheduleCleanup: (job: { messageId: string; channelId: string; invokeMessageId: string; deleteAfter: number; attempts: number }) => {
        scheduled.push(job.deleteAfter);
        due = [{ ...job }];
      },
      dueCleanup: (now: number) => due.filter((job) => job.deleteAfter <= now),
      completeCleanup: (id: string) => {
        completed.push(id);
        due = due.filter((job) => job.messageId !== id);
      },
      deferCleanup: () => undefined,
    };
    const client = { user: { id: "bot" }, channels: { fetch: async () => channel(deletions) } };
    const worker = new CleanupWorker(client as never, store as never);
    const started = Date.now();
    worker.schedule({ botMessageId: "reply-1", channelId: "channel-1", invokeMessageId: "invoke-1" });
    const deadline = scheduled[0]!;
    expect(deadline - started).toBe(90_000);
    worker.stop();
  });
});
