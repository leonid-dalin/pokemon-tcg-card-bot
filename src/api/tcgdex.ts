import type { Card, CardSummary, CardSetRef, SetSummary } from "./types.js";

const BASE = "https://api.tcgdex.net/v2";

export interface ClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  cardTtlMs?: number;
  setTtlMs?: number;
}

interface CacheEntry {
  expires: number;
  value: unknown;
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
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: ClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? BASE;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retries = options.retries ?? 2;
    this.cardTtlMs = options.cardTtlMs ?? 10 * 60_000;
    this.setTtlMs = options.setTtlMs ?? 60 * 60_000;
  }

  private async getJson<T>(path: string, ttlMs: number): Promise<T> {
    // path already carries the language segment
    const cached = this.cache.get(path);
    if (cached && cached.expires > Date.now()) return cached.value as T;

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { accept: "application/json" },
        });
        if (response.status === 404) throw new TcgdexError(`not found: ${path}`, 404);
        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) {
            throw new TcgdexError(`upstream ${response.status}`, response.status);
          }
          throw new TcgdexError(`request failed: ${response.status}`, response.status);
        }
        const value = (await response.json()) as T;
        this.cache.set(path, { expires: Date.now() + ttlMs, value });
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

  /**
   * Text search over ability and attack wording. TCGdex indexes it as `effect`,
   * which is how "search your deck for a Supporter" becomes findable.
   */
  async searchByEffect(text: string, limit = 25, lang = "en"): Promise<CardSummary[]> {
    const query = new URLSearchParams({ effect: text });
    const cards = await this.getJson<CardSummary[]>(`/${lang}/cards?${query.toString()}`, this.cardTtlMs);
    return cards.slice(0, limit);
  }

  /** Every card id and name in the set, without text. Used to build the text index. */
  async listCards(lang = "en"): Promise<CardSummary[]> {
    return this.getJson<CardSummary[]>(`/${lang}/cards`, this.setTtlMs);
  }

  /** TCGdex serves en, fr, de and others but not ja, so a ja request 404s. */
  async getCard(id: string, lang = "en"): Promise<Card> {
    return this.getJson<Card>(`/${lang}/cards/${encodeURIComponent(id)}`, this.cardTtlMs);
  }

  async getSet(id: string, lang = "en"): Promise<CardSetRef> {
    return this.getJson<CardSetRef>(`/${lang}/sets/${encodeURIComponent(id)}`, this.setTtlMs);
  }

  async listSets(lang = "en"): Promise<SetSummary[]> {
    return this.getJson<SetSummary[]>(`/${lang}/sets`, this.setTtlMs);
  }

  clearCache(): void {
    this.cache.clear();
  }
}
