import { describe, expect, it, vi } from "vitest";
import { OverloadedError } from "../src/api/limiter.js";
import { handleAutocomplete } from "../src/discord/commands.js";

type Choice = { name: string; value: string };

function context(searchByName: () => Promise<unknown[]>) {
  return {
    client: { searchByName },
    attribution: "x",
    energyEmoji: {},
    settings: { get: () => ({ cardGames: "both", defaultCardGame: "pocket" }) },
  };
}

async function choices(client: ReturnType<typeof context>): Promise<Choice[]> {
  const responses: Choice[][] = [];
  await handleAutocomplete(client as never, {
    guildId: "g1", user: { id: "member" },
    options: { getFocused: () => ({ name: "name", value: "Mega Mewtwo Y ex" }) },
    respond: async (value: Choice[]) => void responses.push(value),
  } as never);
  return responses[0] ?? [];
}

describe("R4 local autocomplete survives upstream failure", () => {
  it("keeps local candidates on a queue refusal", async () => {
    const result = await choices(context(async () => { throw new OverloadedError("queue-full"); }));
    expect(result.map((choice) => choice.value)).toContain("pc-002");
  });

  it("keeps local candidates on a network rejection", async () => {
    const result = await choices(context(async () => { throw new TypeError("fetch failed"); }));
    expect(result.map((choice) => choice.value)).toContain("pc-002");
  });

  it("keeps local candidates on an empty response", async () => {
    expect((await choices(context(async () => []))).map((choice) => choice.value)).toContain("pc-002");
  });

  it("keeps local candidates on a deadline", async () => {
    vi.useFakeTimers();
    try {
      const pending = choices(context(() => new Promise<never>(() => undefined)));
      await vi.advanceTimersByTimeAsync(2100);
      expect((await pending).map((choice) => choice.value)).toContain("pc-002");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let an optional upstream failure leak as a thrown error", async () => {
    const error = await choices(context(async () => { throw new TypeError("fetch failed"); })).catch((reason) => reason);
    expect(error).not.toBeInstanceOf(Error);
  });
});
