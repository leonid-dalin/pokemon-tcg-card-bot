import { describe, expect, it } from "vitest";
import { OverloadedError, RequestLimiter } from "../src/api/limiter.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("RequestLimiter", () => {
  it("never runs more tasks at once than its concurrency", async () => {
    const limiter = new RequestLimiter({ concurrency: 2, queueLimit: 10 });
    let peak = 0;
    let active = 0;
    const gates = Array.from({ length: 6 }, deferred);
    const tasks = gates.map((gate) =>
      limiter.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
      }),
    );
    expect(limiter.running).toBe(2);
    for (const gate of gates) {
      gate.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(tasks);
    expect(peak).toBe(2);
    expect(limiter.queued).toBe(0);
  });

  it("refuses work once the waiting queue is full", async () => {
    const limiter = new RequestLimiter({ concurrency: 1, queueLimit: 1, queueWaitMs: 1000 });
    const gate = deferred();
    const running = limiter.run(() => gate.promise);
    const queued = limiter.run(async () => undefined);
    await expect(limiter.run(async () => undefined)).rejects.toBeInstanceOf(OverloadedError);
    gate.resolve();
    await Promise.all([running, queued]);
  });

  it("drops a waiter that exceeds the queue wait and frees its slot", async () => {
    const limiter = new RequestLimiter({ concurrency: 1, queueLimit: 4, queueWaitMs: 20 });
    const gate = deferred();
    const running = limiter.run(() => gate.promise);
    await expect(limiter.run(async () => undefined)).rejects.toMatchObject({ reason: "queue-wait" });
    expect(limiter.queued).toBe(0);
    gate.resolve();
    await running;
    expect(limiter.running).toBe(0);
  });

  it("frees the slot when a task throws", async () => {
    const limiter = new RequestLimiter({ concurrency: 1 });
    await expect(
      limiter.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(limiter.running).toBe(0);
    await expect(limiter.run(async () => "ok")).resolves.toBe("ok");
  });
});
