/** Queue-full or queue-timeout rejection for work that cannot be admitted. */
export class OverloadedError extends Error {
  constructor(readonly reason: "queue-full" | "queue-wait") {
    super(reason === "queue-full" ? "upstream queue is full" : "upstream queue wait exceeded");
    this.name = "OverloadedError";
  }
}

export interface LimiterOptions {
  /** Requests allowed to run at once. Defaults to 8. */
  concurrency?: number;
  /** Callers allowed to wait for a slot. Defaults to 32. */
  queueLimit?: number;
  /** Longest a caller may wait for a slot, in milliseconds. Defaults to 5000. */
  queueWaitMs?: number;
}

interface Waiter {
  grant: () => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Bounds how many requests run at once and how many callers may wait.
 * A caller that waits past the deadline is rejected rather than queued forever.
 */
export class RequestLimiter {
  private readonly concurrency: number;
  private readonly queueLimit: number;
  private readonly queueWaitMs: number;
  private active = 0;
  private readonly waiting: Waiter[] = [];

  constructor(options: LimiterOptions = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? 8);
    this.queueLimit = Math.max(0, options.queueLimit ?? 32);
    this.queueWaitMs = Math.max(1, options.queueWaitMs ?? 5000);
  }

  /** Callers running now. */
  get running(): number {
    return this.active;
  }

  /** Callers waiting for a slot. */
  get queued(): number {
    return this.waiting.length;
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiting.shift();
    if (!next) return;
    clearTimeout(next.timer);
    this.active += 1;
    next.grant();
  }

  /** Runs `task` once a slot is free, or rejects with `OverloadedError`. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.concurrency) {
      this.active += 1;
    } else {
      if (this.waiting.length >= this.queueLimit) throw new OverloadedError("queue-full");
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = this.waiting.findIndex((entry) => entry.timer === timer);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new OverloadedError("queue-wait"));
        }, this.queueWaitMs);
        this.waiting.push({ grant: resolve, timer });
      });
    }
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}
