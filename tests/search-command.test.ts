import { afterEach, describe, expect, it, vi } from "vitest";
import { PageStore } from "../src/discord/pages.js";
import { handleSearchCommand } from "../src/discord/commands.js";

const context = {
  client: {} as never,
  attribution: "Card data from TCGdex",
  energyEmoji: {},
  pages: new PageStore(),
};

describe("handleSearchCommand", () => {
  it("returns five results and a first-page label", async () => {
    const calls: { embeds?: unknown[]; components?: { toJSON(): unknown }[] }[] = [];
    const interaction = {
      user: { id: "owner" },
      options: { getString: () => "draw 2 cards" },
      deferReply: async () => {},
      editReply: async (payload: { embeds?: unknown[]; components?: { toJSON(): unknown }[] }) => calls.push(payload),
    };

    await handleSearchCommand(context, interaction as never);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.embeds).toHaveLength(1);
    const payload = JSON.stringify(calls[0]?.components?.map((row) => row.toJSON()));
    // The page label is `n / N`; the total follows the index, so pin the shape.
    const label = payload.match(/"label":"(\d+) \/ (\d+)"/);
    expect(label).not.toBeNull();
    expect(label![1]).toBe("1");
    expect(Number(label![2])).toBeGreaterThan(1);
    expect((calls[0]?.embeds?.[0] as { data: { description?: string } }).data.description?.split("\n\n")).toHaveLength(5);
  });
});

afterEach(() => vi.restoreAllMocks());