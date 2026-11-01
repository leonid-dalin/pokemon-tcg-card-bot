import { afterEach, describe, expect, it, vi } from "vitest";
import { TcgdexClient, TcgdexError } from "../src/api/tcgdex.js";

function summaries(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, name: `${prefix} ${index}` }));
}

function stubSearch(sizes: Record<string, number>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const name = new URL(String(url)).searchParams.get("name") ?? "";
    calls.push(name);
    return { ok: true, status: 200, json: async () => summaries(name, sizes[name] ?? 10) } as unknown as Response;
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("search cache parity", () => {
  it("returns the first 500 summaries in order and serves the repeat from cache", async () => {
    const calls = stubSearch({ ar: 2000 });
    const client = new TcgdexClient({ retries: 0 });
    const first = await client.searchByName("ar");
    const again = await client.searchByName("ar");
    expect(first).toHaveLength(500);
    expect(first[0]?.id).toBe("ar-0");
    expect(first[499]?.id).toBe("ar-499");
    expect(again).toEqual(first);
    expect(calls).toEqual(["ar"]);
  });

  it("honours a smaller limit without shrinking what later callers see", async () => {
    const calls = stubSearch({ ar: 2000 });
    const client = new TcgdexClient({ retries: 0 });
    expect(await client.searchByName("ar", 5)).toHaveLength(5);
    expect(await client.searchByName("ar")).toHaveLength(500);
    expect(calls).toEqual(["ar"]);
  });
});

describe("search cache bounds", () => {
  it("evicts the oldest search once the cached item total passes the cap", async () => {
    const calls = stubSearch({ aa: 2000, bb: 2000, cc: 2000 });
    const client = new TcgdexClient({ retries: 0, maxCachedItems: 1000 });
    await client.searchByName("aa");
    await client.searchByName("bb");
    await client.searchByName("cc");
    calls.length = 0;
    await client.searchByName("cc");
    expect(calls).toEqual([]);
    await client.searchByName("aa");
    expect(calls).toEqual(["aa"]);
  });

  it("counts the trimmed length, so two capped searches fit a 1000-item budget", async () => {
    const calls = stubSearch({ aa: 2000, bb: 2000 });
    const client = new TcgdexClient({ retries: 0, maxCachedItems: 1000 });
    await client.searchByName("aa");
    await client.searchByName("bb");
    calls.length = 0;
    await client.searchByName("aa");
    await client.searchByName("bb");
    expect(calls).toEqual([]);
  });

  it("keeps a lone oversized entry rather than refusing to cache it", async () => {
    const calls = stubSearch({ aa: 2000 });
    const client = new TcgdexClient({ retries: 0, maxCachedItems: 100 });
    await client.searchByName("aa");
    await client.searchByName("aa");
    expect(calls).toEqual(["aa"]);
  });

  it("releases the weight of an expired entry that is refreshed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const calls = stubSearch({ aa: 2000, bb: 2000 });
      const client = new TcgdexClient({ retries: 0, maxCachedItems: 1000, cardTtlMs: 1000 });
      await client.searchByName("aa");
      vi.setSystemTime(Date.now() + 2000);
      await client.searchByName("aa");
      await client.searchByName("bb");
      calls.length = 0;
      await client.searchByName("aa");
      await client.searchByName("bb");
      expect(calls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a malformed 200 response", () => {
  it("fails once without retrying or caching", async () => {
    let fetches = 0;
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return { ok: true, status: 200, json: async () => ({ notAnArray: true }) } as unknown as Response;
    });
    const client = new TcgdexClient({ retries: 2 });
    await expect(client.searchByName("bad")).rejects.toBeInstanceOf(TcgdexError);
    expect(fetches).toBe(1);
    const error = await client.searchByName("my private words").catch((caught: unknown) => caught as Error);
    expect(error.message).not.toContain("private");
    expect(fetches).toBe(2);
  });
});
