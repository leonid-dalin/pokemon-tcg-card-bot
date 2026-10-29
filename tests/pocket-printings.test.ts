import { afterEach, describe, expect, it, vi } from "vitest";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { OverloadedError } from "../src/api/limiter.js";
import { printingsOf } from "../src/printings.js";
import { searchPocketByName } from "../src/api/pocket.js";

afterEach(() => vi.unstubAllGlobals());

const NAME = "Pikachu";

function localExpected(): string[] {
  return searchPocketByName(NAME).map((card) => card.id);
}

describe("a Pocket-only listing never needs upstream", () => {
  it("returns the full local set when upstream succeeds", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => [] }) as unknown as Response);
    const client = new TcgdexClient({ retries: 0 });
    const ids = (await printingsOf(client, NAME, "pocket")).map((printing) => printing.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids)).toEqual(new Set(localExpected()));
  });

  it("returns the same set when upstream fails with 503", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response);
    const client = new TcgdexClient({ retries: 0 });
    const ids = (await printingsOf(client, NAME, "pocket")).map((printing) => printing.id);
    expect(new Set(ids)).toEqual(new Set(localExpected()));
  });

  it("returns the same set when the upstream queue refuses the request", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      throw new OverloadedError("queue-full");
    });
    const client = new TcgdexClient({ retries: 0, limiter: { concurrency: 1, queueLimit: 0 } });
    const ids = (await printingsOf(client, NAME, "pocket")).map((printing) => printing.id);
    expect(new Set(ids)).toEqual(new Set(localExpected()));
    expect(calls).toEqual([]);
  });

  it("still reports busy when a physical listing needs an unavailable upstream result", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new OverloadedError("queue-full");
    });
    const client = new TcgdexClient({ retries: 0, limiter: { concurrency: 1, queueLimit: 0 } });
    await expect(printingsOf(client, NAME, "ptcg")).rejects.toBeInstanceOf(OverloadedError);
  });
});
