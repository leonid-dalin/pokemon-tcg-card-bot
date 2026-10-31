/** Default burst for a budget built without an explicit capacity. */
export const DEFAULT_BURST = 3;

export interface BucketOptions {
  /** Token capacity of a full bucket. Defaults to 3. */
  capacity?: number;
  /** Seconds required to refill one token. Defaults to 5. */
  refillSeconds?: number;
  /** Maximum tracked keys before the oldest buckets are removed. Defaults to 10000. */
  maxKeys?: number;
}

interface Bucket {
  tokens: number;
  updated: number;
}

/** Token bucket with bounded storage for caller-supplied keys. */
export class MentionBudget {
  private readonly capacity: number;
  private readonly refillMs: number;
  private readonly maxKeys: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: BucketOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? DEFAULT_BURST);
    this.refillMs = Math.max(1, options.refillSeconds ?? 5) * 1000;
    this.maxKeys = Math.max(1, options.maxKeys ?? 10_000);
  }

  /** Number of keys currently tracked. */
  get size(): number {
    return this.buckets.size;
  }

  // Remove refilled buckets before evicting the oldest active key.
  private prune(now: number): void {
    if (this.buckets.size < this.maxKeys) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.tokens + Math.floor((now - bucket.updated) / this.refillMs) >= this.capacity) {
        this.buckets.delete(key);
      }
    }
    while (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }

  /** Consumes a token or returns a retry delay in seconds; `now` is in milliseconds. */
  take(key: string, now = Date.now()): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    if (!this.buckets.has(key)) this.prune(now);
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
