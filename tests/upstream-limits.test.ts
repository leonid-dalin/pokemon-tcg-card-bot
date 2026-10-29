import { afterEach, describe, expect, it, vi } from "vitest";
import { TcgdexClient, TcgdexError } from "../src/api/tcgdex.js";
import { OverloadedError } from "../src/api/limiter.js";

const card = { id: "sv08.5-073", name: "Dragapult ex", image: "https://img/1" };

function stubFetch(routes: Record<string, unknown[] | unknown>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(String(url));
    const route = Object.keys(routes).find((key) => String(url).includes(key));
    const queued = route ? (routes[route] as unknown[]) : undefined;
    const entry = Array.isArray(queued) ? queued.shift() : queued;
    if (entry instanceof Error) throw entry;
    const response = entry as { status?: number; body?: unknown };
    const status = response?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => response?.body ?? card,
    } as unknown as Response;
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("bounded upstream requests", () => {
  it("shares one request between concurrent identical lookups", async () => {
    const calls = stubFetch({ "/cards/sv08.5-073": { body: card } });
    const client = new TcgdexClient({ retries: 0 });
    const [a, b, c] = await Promise.all([
      client.getCard("sv08.5-073"),
      client.getCard("sv08.5-073"),
      client.getCard("sv08.5-073"),
    ]);
    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("keeps locales distinct when sharing in-flight work", async () => {
    const calls = stubFetch({ "/en/cards/": { body: card }, "/de/cards/": { body: card } });
    const client = new TcgdexClient({ retries: 0 });
    await Promise.all([client.getCard("sv08.5-073", "en"), client.getCard("sv08.5-073", "de")]);
    expect(calls).toHaveLength(2);
  });

  it("retries a shared request that already failed elsewhere", async () => {
    const calls = stubFetch({ "/cards/sv08.5-073": [{ status: 503, body: {} }, { body: card }] });
    const client = new TcgdexClient({ retries: 0 });
    await expect(client.getCard("sv08.5-073")).rejects.toBeInstanceOf(TcgdexError);
    await expect(client.getCard("sv08.5-073")).resolves.toMatchObject({ name: "Dragapult ex" });
    expect(calls).toHaveLength(2);
  });

  it("never runs more requests at once than its limit", async () => {
    const calls = stubFetch({ "/cards/": { body: card } });
    const client = new TcgdexClient({ retries: 0, limiter: { concurrency: 2, queueLimit: 10 } });
    await Promise.all(
      ["a-1", "a-2", "a-3", "a-4", "a-5", "a-6"].map((id) => client.getCard(id)),
    );
    expect(calls).toHaveLength(6);
    expect(client.queue.running).toBe(0);
    expect(client.queue.queued).toBe(0);
  });

  it("rejects with an overload error once the queue is full", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal("fetch", async () => {
      await gate;
      return { ok: true, status: 200, json: async () => card } as unknown as Response;
    });
    const client = new TcgdexClient({
      retries: 0,
      limiter: { concurrency: 1, queueLimit: 1, queueWaitMs: 5000 },
    });
    const running = client.getCard("hold-1");
    const queued = client.getCard("hold-2");
    await expect(client.getCard("hold-3")).rejects.toBeInstanceOf(OverloadedError);
    release();
    await Promise.all([running, queued]);
  });

  it("keeps a 404 distinct from an overload", async () => {
    stubFetch({ "/cards/gone-1": { status: 404, body: {} } });
    const client = new TcgdexClient({ retries: 0 });
    await expect(client.getCard("gone-1")).rejects.toMatchObject({ status: 404 });
    const overloaded = new OverloadedError("queue-wait");
    expect(overloaded).not.toBeInstanceOf(TcgdexError);
  });

  it("leaves a rejected request uncached so a later attempt can succeed", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      await gate;
      return { ok: true, status: 200, json: async () => card } as unknown as Response;
    });
    const client = new TcgdexClient({
      retries: 0,
      limiter: { concurrency: 1, queueLimit: 0, queueWaitMs: 5000 },
    });
    const holding = client.getCard("hold-1");
    await expect(client.getCard("later-1")).rejects.toBeInstanceOf(OverloadedError);
    release();
    await holding;
    await expect(client.getCard("later-1")).resolves.toMatchObject({ name: "Dragapult ex" });
    expect(calls).toBe(2);
  });
});
