import type { Card, CardSummary, CardSetRef, SetSummary } from "./types.js";

const BASE = "https://api.tcgdex.net/v2";

export interface ClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  cardTtlMs?: number;
  setTtlMs?: number;
  /** Most responses held at once. Autocomplete caches every prefix typed. */
  maxEntries?: number;
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
 * Thin read-only client for TCGdex. TCGdex needs no API key and serves the
 * catalogue plus Cardmarket and TCGplayer pricing, so the bot has no secrets to
 * rotate and no quota to burn.
 */
export class TcgdexClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly cardTtlMs: number;
  private readonly setTtlMs: number;
  private readonly maxEntries: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: ClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? BASE;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retries = options.retries ?? 2;
    this.cardTtlMs = options.cardTtlMs ?? 10 * 60_000;
    this.setTtlMs = options.setTtlMs ?? 60 * 60_000;
    this.maxEntries = Math.max(1, options.maxEntries ?? 1000);
  }

  private remember(path: string, entry: CacheEntry): void {
    this.cache.delete(path);
    if (this.cache.size >= this.maxEntries) {
      const now = Date.now();
      for (const [key, held] of this.cache) if (held.expires <= now) this.cache.delete(key);
    }
    // Map keeps insertion order, so the first key is the oldest entry.
    while (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    this.cache.set(path, entry);
  }

  private async getJson<T>(path: string, ttlMs: number): Promise<T> {
    // path already carries the language segment
    const cached = this.cache.get(path);
    if (cached && cached.expires > Date.now()) {
      // A 404 is remembered too, or every lookup of a card without prices asks
      // again for the languages that do not carry it.
      if (cached.missing) throw new TcgdexError(`not found: ${path}`, 404);
      return cached.value as T;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { accept: "application/json" },
        });
        if (response.status === 404) {
          this.remember(path, { expires: Date.now() + ttlMs, missing: true });
          throw new TcgdexError(`not found: ${path}`, 404);
        }
        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) {
            throw new TcgdexError(`upstream ${response.status}`, response.status);
          }
          throw new TcgdexError(`request failed: ${response.status}`, response.status);
        }
        const value = (await response.json()) as T;
        this.remember(path, { expires: Date.now() + ttlMs, value });
        return value;
      } catch (error) {
        lastError = error;
        const retryable =
          !(error instanceof TcgdexError) || error.status === 429 || (error.status ?? 0) >= 500;
        if (!retryable || attempt === this.retries) break;
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new TcgdexError(String(lastError));
  }

  /**
   * Name search is a prefix match upstream, so a common name returns well over a
   * hundred printings. The cap is deliberately high: filtering by set happens
   * locally, and the upstream `set` parameter is ignored, so a low cap silently
   * drops the printing the caller asked for.
   */
  async searchByName(name: string, limit = 500, lang = "en"): Promise<CardSummary[]> {
    const query = new URLSearchParams({ name });
    const cards = await this.getJson<CardSummary[]>(`/${lang}/cards?${query.toString()}`, this.cardTtlMs);
    return cards.slice(0, limit);
  }

  /** Every card id and name in the set, without text. Used to build the text index. */
  async listCards(lang = "en"): Promise<CardSummary[]> {
    return this.getJson<CardSummary[]>(`/${lang}/cards`, this.setTtlMs);
  }

  /**
   * TCGdex has a ja catalogue, but its ids differ from the English ones, so an
   * English id asked for under ja always 404s.
   */
  async getCard(id: string, lang = "en"): Promise<Card> {
    return this.getJson<Card>(`/${lang}/cards/${encodeURIComponent(id)}`, this.cardTtlMs);
  }

  async getSet(id: string, lang = "en"): Promise<CardSetRef> {
    return this.getJson<CardSetRef>(`/${lang}/sets/${encodeURIComponent(id)}`, this.setTtlMs);
  }

  async listSets(lang = "en"): Promise<SetSummary[]> {
    return this.getJson<SetSummary[]>(`/${lang}/sets`, this.setTtlMs);
  }
}
