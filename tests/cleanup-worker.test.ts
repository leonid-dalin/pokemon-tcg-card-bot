import { ChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
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
  function fakeClockStore(deletions: string[], options: { reject?: (id: string) => unknown } = {}) {
    type Job = typeof JOB & { deleteAfter: number };
    let due: Job[] = [];
    const completed: string[] = [];
    const deferred: { id: string; at: number }[] = [];
    return {
      completed,
      deferred,
      store: {
        scheduleCleanup: (job: Job) => void (due = [{ ...job }]),
        dueCleanup: (now: number) => due.filter((job) => job.deleteAfter <= now),
        nextCleanupAt: () => (due.length > 0 ? Math.min(...due.map((job) => job.deleteAfter)) : undefined),
        completeCleanup: (id: string) => {
          completed.push(id);
          due = due.filter((job) => job.messageId !== id);
        },
        deferCleanup: (id: string, at: number) => {
          deferred.push({ id, at });
          due = due.map((job) => (job.messageId === id ? { ...job, deleteAfter: at, attempts: job.attempts + 1 } : job));
        },
      },
      client: { user: { id: "bot" }, channels: { fetch: async () => channel(deletions, { reject: options.reject }) } },
    };
  }

  it("deletes the message when the deadline arrives", async () => {
    vi.useFakeTimers();
    const deletions: string[] = [];
    const fx = fakeClockStore(deletions);
    const worker = new CleanupWorker(fx.client as never, fx.store as never);
    worker.schedule({ botMessageId: "reply-1", channelId: "channel-1", invokeMessageId: "invoke-1" });
    expect(deletions).toEqual([]);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(deletions).toEqual(["reply-1", "invoke-1"]);
    expect(fx.completed).toEqual(["reply-1"]);
    worker.stop();
    vi.useRealTimers();
  });

  it("retries at the backoff deadline after a failed deletion", async () => {
    vi.useFakeTimers();
    const deletions: string[] = [];
    let failOnce = true;
    const fx = fakeClockStore(deletions, {
      reject: (id) => (id === "invoke-1" && failOnce ? ((failOnce = false), { code: 50013 }) : undefined),
    });
    const worker = new CleanupWorker(fx.client as never, fx.store as never);
    worker.schedule({ botMessageId: "reply-1", channelId: "channel-1", invokeMessageId: "invoke-1" });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fx.completed).toEqual([]);
    expect(fx.deferred).toHaveLength(1);
    // The first retry waits RETRY_BASE_MS.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fx.completed).toEqual(["reply-1"]);
    worker.stop();
    vi.useRealTimers();
  });
});

describe("cleanup worker deadline arming", () => {
  it("keeps the earlier armed deadline when a later job arrives", async () => {
    vi.useFakeTimers();
    const deletions: string[] = [];
    type Job = typeof JOB & { deleteAfter: number };
    const due: Job[] = [];
    const store = {
      scheduleCleanup: (job: Job) => void due.push({ ...job }),
      dueCleanup: (now: number) => due.filter((job) => job.deleteAfter <= now),
      nextCleanupAt: () => (due.length > 0 ? Math.min(...due.map((job) => job.deleteAfter)) : undefined),
      completeCleanup: (id: string) => {
        deletions.push(`completed:${id}`);
        const index = due.findIndex((job) => job.messageId === id);
        if (index >= 0) due.splice(index, 1);
      },
      deferCleanup: () => undefined,
    };
    const client = { user: { id: "bot" }, channels: { fetch: async () => channel(deletions) } };
    const worker = new CleanupWorker(client as never, store as never);
    worker.schedule({ botMessageId: "reply-1", channelId: "channel-1", invokeMessageId: "invoke-1" });
    await vi.advanceTimersByTimeAsync(80_000);
    // A second job arrives ten seconds before the first is due; it must not delay it.
    worker.schedule({ botMessageId: "reply-2", channelId: "channel-1", invokeMessageId: "invoke-2" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deletions).toContain("completed:reply-1");
    worker.stop();
    vi.useRealTimers();
  });
});

describe("cleanup worker future deadlines", () => {
  it("keeps a later job's exact deadline after the first completes", async () => {
    vi.useFakeTimers();
    const deletions: string[] = [];
    type Job = typeof JOB & { deleteAfter: number };
    let due: Job[] = [];
    const store = {
      scheduleCleanup: (job: Job) => void due.push({ ...job }),
      dueCleanup: (now: number) => due.filter((job) => job.deleteAfter <= now),
      nextCleanupAt: () => (due.length > 0 ? Math.min(...due.map((job) => job.deleteAfter)) : undefined),
      completeCleanup: (id: string) => {
        due = due.filter((job) => job.messageId !== id);
      },
      deferCleanup: () => undefined,
    };
    const client = { user: { id: "bot" }, channels: { fetch: async () => channel(deletions) } };
    const worker = new CleanupWorker(client as never, store as never);
    worker.schedule({ botMessageId: "a", channelId: "channel-1", invokeMessageId: "a-invoke" });
    await vi.advanceTimersByTimeAsync(80_000);
    worker.schedule({ botMessageId: "b", channelId: "channel-1", invokeMessageId: "b-invoke" });
    // A is due at 90s; B at 170s. Neither may slip to a 30-second poll tick.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deletions).toContain("a");
    await vi.advanceTimersByTimeAsync(80_000);
    expect(deletions).toContain("b");
    worker.stop();
    vi.useRealTimers();
  });
});

describe("cleanup worker shutdown and retry timing", () => {
  it("measures the retry deadline from when the failure is handled", async () => {
    vi.useFakeTimers();
    const deferred: number[] = [];
    let clock = 1_000_000;
    vi.setSystemTime(clock);
    const store = {
      scheduleCleanup: () => undefined,
      dueCleanup: () => [{ ...JOB, attempts: 0 }],
      nextCleanupAt: () => undefined,
      completeCleanup: () => undefined,
      deferCleanup: (_id: string, at: number) => void deferred.push(at),
    };
    // The channel fetch takes 45 seconds, so the drain starts well before it fails.
    const slow = {
      type: ChannelType.GuildText,
      isTextBased: () => true,
      permissionsFor: () => ({ has: () => true }),
      messages: {
        fetch: async (messageId: string) => {
          clock += 45_000;
          vi.setSystemTime(clock);
          if (messageId === "invoke-1") throw { code: 50013 };
          return { delete: async () => undefined };
        },
      },
    };
    const client = { user: { id: "bot" }, channels: { fetch: async () => slow } };
    const worker = new CleanupWorker(client as never, store as never);
    await worker.drain();
    expect(deferred).toHaveLength(1);
    // RETRY_BASE_MS from the failure time, not from the drain start.
    expect(deferred[0]! - clock).toBe(60_000);
    vi.useRealTimers();
  });
});
