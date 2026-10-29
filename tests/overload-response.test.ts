import { afterEach, describe, expect, it, vi } from "vitest";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { OverloadedError } from "../src/api/limiter.js";
import { busyMessage, overloadHint } from "../src/discord/interaction-failure.js";
import { handleSetCommand } from "../src/discord/commands.js";

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

describe("upstream queue rejection reaches the member as busy", () => {
  it("maps both overload reasons to a hint", () => {
    expect(overloadHint(new OverloadedError("queue-full"))).toBe(5);
    expect(overloadHint(new OverloadedError("queue-wait"))).toBe(2);
    expect(overloadHint(new Error("other"))).toBeUndefined();
    expect(overloadHint(undefined)).toBeUndefined();
  });

  it("reports busy on /set rather than claiming no set matched", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new OverloadedError("queue-full");
    });
    const client = new TcgdexClient({ retries: 0, limiter: { concurrency: 1, queueLimit: 0 } });
    const { interaction, calls } = setInteraction();

    await handleSetCommand({ ...context, client } as never, interaction as never);

    expect(calls[1]).toBe(`edit:${busyMessage(5)}`);
    expect(calls[1]).not.toContain("No set matched");
  });
});
