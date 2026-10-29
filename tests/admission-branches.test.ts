import { afterEach, describe, expect, it, vi } from "vitest";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { OverloadedError } from "../src/api/limiter.js";
import { busyMessage, reportInteractionFailure } from "../src/discord/interaction-failure.js";
import { handleAutocomplete, handleCardCommand, handlePrintingButton, handlePrintingsCommand } from "../src/discord/commands.js";

afterEach(() => vi.unstubAllGlobals());

function countingFetch(response: () => Response) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(String(url));
    return response();
  });
  return calls;
}

const base = {
  attribution: "Card data from TCGdex",
  energyEmoji: {},
};

describe("printing press and set autocomplete consult the budget", () => {
  it("refuses an authorised printing press without fetching when the member is out of budget", async () => {
    const calls = countingFetch(() => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response);
    const sent: string[] = [];
    const interaction = {
      customId: "printing:b4-212:owner",
      guildId: "guild-a",
      user: { id: "owner" },
      deferUpdate: async () => sent.push("defer"),
      followUp: async (payload: { content: string }) => sent.push(`followUp:${payload.content}`),
      editReply: async () => sent.push("edit"),
    };
    const context = {
      ...base,
      client: new TcgdexClient({ retries: 0 }),
      requests: { take: () => ({ allowed: false as const, retryAfterSeconds: 2 }) },
    };

    await handlePrintingButton(context as never, interaction as never);

    expect(calls).toEqual([]);
    expect(sent).toEqual(["defer", `followUp:${busyMessage(2)}`]);
  });

  it("still refuses another member's press before charging anything", async () => {
    const taken: string[] = [];
    const interaction = {
      customId: "printing:b4-212:owner",
      guildId: "guild-a",
      user: { id: "someone-else" },
      reply: async () => undefined,
      deferUpdate: async () => undefined,
      followUp: async () => undefined,
      editReply: async () => undefined,
    };
    const context = {
      ...base,
      client: new TcgdexClient({ retries: 0 }),
      requests: { take: (key: string) => { taken.push(key); return { allowed: true as const }; } },
    };

    await handlePrintingButton(context as never, interaction as never);

    expect(taken).toEqual([]);
  });

  it("refuses a cold set catalogue lookup without fetching when typing is exhausted", async () => {
    const calls = countingFetch(() => ({ ok: true, status: 200, json: async () => [] }) as unknown as Response);
    const responses: unknown[] = [];
    const interaction = {
      guildId: "guild-a",
      user: { id: "member-1" },
      options: { getFocused: () => ({ name: "id", value: "sv0" }) },
      respond: async (value: unknown) => void responses.push(value),
    };
    const context = {
      ...base,
      client: new TcgdexClient({ retries: 0 }),
      typing: { take: () => ({ allowed: false as const, retryAfterSeconds: 2 }) },
    };

    await handleAutocomplete(context as never, interaction as never);

    expect(calls).toEqual([]);
    expect(responses).toEqual([[]]);
  });

  it("lets set autocomplete fetch when typing has budget", async () => {
    const calls = countingFetch(() => ({
      ok: true,
      status: 200,
      json: async () => [{ id: "sv01", name: "Scarlet & Violet" }],
    }) as unknown as Response);
    const responses: unknown[] = [];
    const interaction = {
      guildId: "guild-a",
      user: { id: "member-1" },
      options: { getFocused: () => ({ name: "id", value: "sv0" }) },
      respond: async (value: unknown) => void responses.push(value),
    };
    const context = {
      ...base,
      client: new TcgdexClient({ retries: 0 }),
      typing: { take: () => ({ allowed: true as const }) },
    };

    await handleAutocomplete(context as never, interaction as never);

    expect(calls).toHaveLength(1);
    expect(responses[0]).toEqual([{ name: "Scarlet & Violet (sv01)", value: "sv01" }]);
  });
});

describe("overload reaches every response path", () => {
  it("answers autocomplete with an empty list instead of silence", async () => {
    let responded: unknown[] | undefined;
    const interaction = {
      isAutocomplete: () => true,
      isRepliable: () => false,
      isChatInputCommand: () => false,
      deferred: false,
      replied: false,
      respond: async (value: unknown[]) => void (responded = value),
    };

    await reportInteractionFailure(interaction as never, new OverloadedError("queue-full"));

    expect(responded).toEqual([]);
  });

  it("turns a queue rejection on /card into a busy reply", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new OverloadedError("queue-wait");
    });
    const client = new TcgdexClient({ retries: 0, limiter: { concurrency: 1, queueLimit: 0 } });
    const sent: string[] = [];
    const interaction = {
      guildId: "guild-a",
      user: { id: "member-1" },
      options: { getString: (name: string) => (name === "name" ? "Dragapult ex" : null), getBoolean: () => null },
      isRepliable: () => true,
      isAutocomplete: () => false,
      isChatInputCommand: () => true,
      deferred: true,
      replied: false,
      deferReply: async () => sent.push("defer"),
      editReply: async (payload: { content?: string }) => sent.push(`edit:${payload.content ?? ""}`),
      followUp: async (payload: { content?: string }) => sent.push(`follow:${payload.content ?? ""}`),
    };

    try {
      await handleCardCommand({ ...base, client } as never, interaction as never);
    } catch (error) {
      await reportInteractionFailure(interaction as never, error);
    }

    expect(sent.join("|")).toContain(busyMessage(2));
    expect(sent.join("|")).not.toContain("Card lookup failed");
  });

  it("keeps a refusal out of the physical printings fallback", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new OverloadedError("queue-full");
    });
    const client = new TcgdexClient({ retries: 0, limiter: { concurrency: 1, queueLimit: 0 } });
    const sent: string[] = [];
    const interaction = {
      guildId: "guild-a",
      user: { id: "member-1" },
      options: { getString: () => "Dragapult ex" },
      deferReply: async () => sent.push("defer"),
      editReply: async (payload: { content?: string }) => sent.push(`edit:${payload.content ?? ""}`),
    };

    await handlePrintingsCommand({ ...base, client } as never, interaction as never);

    expect(sent[1]).toBe(`edit:${busyMessage(5)}`);
    expect(sent[1]).not.toContain("No card matched");
  });
});
