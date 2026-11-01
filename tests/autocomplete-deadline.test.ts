import { describe, expect, it, vi } from "vitest";
import { handleAutocomplete } from "../src/discord/commands.js";

/** A client whose name search never settles, as a stalled upstream looks. */
function stalledContext() {
  const respond = vi.fn(async () => {});
  return {
    respond,
    context: {
      client: {
        searchByName: () => new Promise(() => {}),
        listSets: async () => [],
      },
      settings: { get: () => ({ cardGames: "both" }) },
      typing: { take: () => ({ allowed: true }) },
    } as never,
  };
}

function interactionFor(name: string, respond: (rows: unknown[]) => Promise<void>) {
  return {
    guildId: "g1",
    user: { id: "u1" },
    options: { getFocused: () => ({ name, value: "gamma" }) },
    respond,
  } as never;
}

describe("autocomplete on a stalled upstream", () => {
  it("answers empty rather than hanging the interaction", async () => {
    const { respond, context } = stalledContext();

    await handleAutocomplete(context, interactionFor("name", respond));

    expect(respond).toHaveBeenCalledWith([]);
  }, 10_000);
});
