import type { Card, CardSetDetail, CardSummary, SetSummary } from "./types.js";
import { OverloadedError, RequestLimiter, type LimiterOptions } from "./limiter.js";

const BASE = "https://api.tcgdex.net/v2";

export interface ClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  cardTtlMs?: number;
  setTtlMs?: number;
  /** Maximum cache entries, including remembered 404 responses. */
  maxEntries?: number;
  limiter?: LimiterOptions;
}

interface CacheEntry {
  expires: number;
  /** Absent for a remembered 404. */
  value?: unknown;
  missing?: true;
}

export class TcgdexError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TcgdexError";
  }
}

/**
 * Cached TCGdex requests with per-attempt timeouts.
 * Retries transport/parsing errors, rate limits and server errors.
 */
export class TcgdexClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly cardTtlMs: number;
  private readonly setTtlMs: number;
  private readonly maxEntries: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly limiter: RequestLimiter;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? BASE;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retries = options.retries ?? 2;
    this.cardTtlMs = options.cardTtlMs ?? 10 * 60_000;
    this.setTtlMs = options.setTtlMs ?? 60 * 60_000;
    this.maxEntries = Math.max(1, options.maxEntries ?? 1000);
    this.limiter = new RequestLimiter(options.limiter);
  }

  get queue(): { running: number; queued: number } {
    return { running: this.limiter.running, queued: this.limiter.queued };
  }

  private remember(path: string, entry: CacheEntry): void {
    this.cache.delete(path);
    if (this.cache.size >= this.maxEntries) {
      const now = Date.now();
      for (const [key, held] of this.cache) if (held.expires <= now) this.cache.delete(key);
    }
    // Map iteration follows insertion order, so the first key is the oldest.
    while (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    this.cache.set(path, entry);
  }

  private async getJson<T>(path: string, ttlMs: number): Promise<T> {
    const cached = this.cache.get(path);
    if (cached && cached.expires > Date.now()) {
      // Re-throw cached misses without another request.
      if (cached.missing) throw new TcgdexError(`not found: ${path}`, 404);
      return cached.value as T;
    }

    const shared = this.inFlight.get(path);
    if (shared) return shared as Promise<T>;

    const request = this.request<T>(path, ttlMs).finally(() => {
      this.inFlight.delete(path);
    });
    this.inFlight.set(path, request);
    return request;
  }

  private async request<T>(path: string, ttlMs: number): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        // The slot covers the body too: headers arrive long before the payload, so
        // releasing on fetch() alone would bound only the wait for headers.
        const value = await this.limiter.run(async () => {
          const response = await fetch(`${this.baseUrl}${path}`, {
            signal: AbortSignal.timeout(this.timeoutMs),
            headers: { accept: "application/json" },
          });
          if (response.status === 404) {
            await response.body?.cancel().catch(() => undefined);
            this.remember(path, { expires: Date.now() + ttlMs, missing: true });
            throw new TcgdexError(`not found: ${path}`, 404);
          }
          if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            if (response.status === 429 || response.status >= 500) {
              throw new TcgdexError(`upstream ${response.status}`, response.status);
            }
            throw new TcgdexError(`request failed: ${response.status}`, response.status);
          }
          return (await response.json()) as T;
        });
        this.remember(path, { expires: Date.now() + ttlMs, value });
        return value;
      } catch (error) {
        lastError = error;
        if (error instanceof OverloadedError) break;
        const retryable =
          !(error instanceof TcgdexError) || error.status === 429 || (error.status ?? 0) >= 500;
        if (!retryable || attempt === this.retries) break;
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new TcgdexError(String(lastError));
  }

  /** Searches by name and returns at most `limit` summaries. */
  async searchByName(name: string, limit = 500, lang = "en"): Promise<CardSummary[]> {
    const query = new URLSearchParams({ name });
    const cards = await this.getJson<CardSummary[]>(`/${lang}/cards?${query.toString()}`, this.cardTtlMs);
    return cards.slice(0, limit);
  }

  /** Lists card summaries for a language. */
  async listCards(lang = "en"): Promise<CardSummary[]> {
    return this.getJson<CardSummary[]>(`/${lang}/cards`, this.setTtlMs);
  }

  /** Fetches a card by ID in the requested language. */
  async getCard(id: string, lang = "en"): Promise<Card> {
    return this.getJson<Card>(`/${lang}/cards/${encodeURIComponent(id)}`, this.cardTtlMs);
  }

  async getSet(id: string, lang = "en"): Promise<CardSetDetail> {
    return this.getJson<CardSetDetail>(`/${lang}/sets/${encodeURIComponent(id)}`, this.setTtlMs);
  }

  async listSets(lang = "en"): Promise<SetSummary[]> {
    return this.getJson<SetSummary[]>(`/${lang}/sets`, this.setTtlMs);
  }
}
