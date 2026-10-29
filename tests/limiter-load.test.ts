import { describe, expect, it } from "vitest";
import { OverloadedError, RequestLimiter } from "../src/api/limiter.js";

/**
 * Documents the shipped defaults by measuring them. Defaults are concurrency 8,
 * queue 32 and a 5000ms wait, so 200 simultaneous callers must run 8, hold 32
 * and refuse the remaining 160 rather than accept unbounded work.
 */
describe("limiter defaults under load", () => {
  it("admits concurrency plus queue and refuses the rest", async () => {
    const limiter = new RequestLimiter();
    let active = 0;
    let peakActive = 0;
    let peakQueued = 0;
    let admitted = 0;
    let refused = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const tasks = Array.from({ length: 200 }, () =>
      limiter
        .run(async () => {
          admitted += 1;
          active += 1;
          peakActive = Math.max(peakActive, active);
          peakQueued = Math.max(peakQueued, limiter.queued);
          await gate;
          active -= 1;
        })
        .catch((error: unknown) => {
          if (!(error instanceof OverloadedError)) throw error;
          refused += 1;
        }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(peakActive).toBeLessThanOrEqual(8);
    expect(peakQueued).toBeLessThanOrEqual(32);
    expect(admitted).toBe(8);
    expect(refused).toBe(160);

    release();
    await Promise.all(tasks);
    expect(admitted).toBe(40);
    expect(limiter.running).toBe(0);
    expect(limiter.queued).toBe(0);
  });

  it("drains the queue without exceeding concurrency", async () => {
    const limiter = new RequestLimiter({ concurrency: 8, queueLimit: 32, queueWaitMs: 5000 });
    let active = 0;
    let peakActive = 0;
    const tasks = Array.from({ length: 40 }, () =>
      limiter.run(async () => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
      }),
    );
    await Promise.all(tasks);
    expect(peakActive).toBeLessThanOrEqual(8);
    expect(limiter.queued).toBe(0);
  });
});
