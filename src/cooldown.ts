export interface BucketOptions {
  /** How many mentions one member may fire back to back. */
  capacity?: number;
  /** Seconds to regain one mention. */
  refillSeconds?: number;
}

interface Bucket {
  tokens: number;
  updated: number;
}

/**
 * Token bucket per member per channel. A fixed cooldown is the wrong shape for
 * a card bot: someone testing four cards in a row is normal, while one person
 * pasting twenty is not. A bucket allows the burst and still bounds the rate.
 */
export class MentionBudget {
  private readonly capacity: number;
  private readonly refillMs: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: BucketOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? 3);
    this.refillMs = Math.max(1, options.refillSeconds ?? 5) * 1000;
  }

  /** Returns true when the mention may be answered, false with the wait in seconds. */
  take(key: string, now = Date.now()): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updated: now };
    const refilled = Math.min(
      this.capacity,
      bucket.tokens + Math.floor((now - bucket.updated) / this.refillMs),
    );
    const updated =
      refilled >= this.capacity ? now : bucket.updated + (refilled - bucket.tokens) * this.refillMs;

    if (refilled < 1) {
      const waitMs = Math.max(0, this.refillMs - (now - updated));
      this.buckets.set(key, { tokens: refilled, updated });
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
    }

    this.buckets.set(key, { tokens: refilled - 1, updated });
    return { allowed: true };
  }
}
