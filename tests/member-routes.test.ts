import { afterEach, describe, expect, it, vi } from "vitest";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { busyMessage } from "../src/discord/interaction-failure.js";
import { handlePrintingsCommand, handleSetCommand } from "../src/discord/commands.js";

afterEach(() => vi.unstubAllGlobals());

const context = {
  client: new TcgdexClient({ retries: 0 }),
  attribution: "Card data from TCGdex",
  energyEmoji: {},
};

function setInteraction() {
  const calls: string[] = [];
  return {
    calls,
    interaction: {
      guildId: "guild-a",
      user: { id: "member-1" },
      options: {
        getString: () => "xy2",
        getBoolean: () => false,
      },
      deferReply: async () => calls.push("defer"),
      editReply: async (payload: { content?: string }) => calls.push(`edit:${payload.content ?? ""}`),
    },
  };
}

describe("exhausted member cannot reach upstream through sibling routes", () => {
  it("answers busy on /set without fetching", async () => {
    const fetches: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetches.push(String(url));
      return { ok: true, status: 200, json: async () => ({ id: "xy2" }), body: undefined } as unknown as Response;
    });
    const throttled = {
      ...context,
      requests: { take: () => ({ allowed: false as const, retryAfterSeconds: 4 }) },
    };
    const { interaction, calls } = setInteraction();

    await handleSetCommand(throttled as never, interaction as never);

    expect(calls).toEqual(["defer", `edit:${busyMessage(4)}`]);
    expect(fetches).toEqual([]);
  });

  it("answers busy on /printings without fetching", async () => {
    const fetches: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetches.push(String(url));
      return { ok: true, status: 200, json: async () => [], body: undefined } as unknown as Response;
    });
    const throttled = {
      ...context,
      requests: { take: () => ({ allowed: false as const, retryAfterSeconds: 4 }) },
    };
    const calls: string[] = [];
    const interaction = {
      guildId: "guild-a",
      user: { id: "member-1" },
      options: { getString: () => "Dragapult ex" },
      deferReply: async () => calls.push("defer"),
      editReply: async (payload: { content?: string }) => calls.push(`edit:${payload.content ?? ""}`),
    };

    await handlePrintingsCommand(throttled as never, interaction as never);

    expect(fetches).toEqual([]);
    expect(calls[1]).toBe(`edit:${busyMessage(4)}`);
  });

  it("keeps another guild's allowance intact", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => ({ id: "xy2" }), body: undefined }) as unknown as Response);
    const taken: string[] = [];
    const contextWithBudget = {
      ...context,
      requests: {
        take: (key: string) => {
          taken.push(key);
          return key.startsWith("guild-a:") ? { allowed: false as const, retryAfterSeconds: 3 } : { allowed: true as const };
        },
      },
    };
    const other = setInteraction();
    other.interaction.guildId = "guild-b";

    await handleSetCommand(contextWithBudget as never, other.interaction as never);

    expect(taken).toEqual(["guild-b:member-1"]);
    expect(other.calls[1]).not.toContain("busy");
  });
});
