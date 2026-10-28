import { MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { PageStore } from "../src/discord/pages.js";
import { handlePageButton } from "../src/discord/commands.js";

const makeContext = (store: PageStore) => ({
  client: {} as never,
  attribution: "Card data from TCGdex",
  energyEmoji: {},
  pages: store,
});

describe("handlePageButton", () => {
  it("refuses a page press from someone other than its owner", async () => {
    const pages = new PageStore();
    const token = pages.put({ title: "Cards", items: [], perPage: 5, ownerId: "owner", footer: "Source" });
    const calls: { content: string; flags: number }[] = [];
    const interaction = {
      customId: `page:${token}:0`,
      user: { id: "other" },
      reply: async (payload: { content: string; flags: number }) => calls.push(payload),
      update: async () => calls.push({ content: "updated", flags: 0 }),
    };

    await handlePageButton(makeContext(pages), interaction as never);

    expect(calls).toEqual([{
      content: "Only the person who asked can change this. Ask for your own copy with [[name]] or /card.",
      flags: MessageFlags.Ephemeral,
    }]);
  });

  it("answers ephemerally when a list token has expired", async () => {
    let now = 0;
    const pages = new PageStore({ ttlMs: 10, now: () => now });
    const token = pages.put({ title: "Cards", items: [], perPage: 5, ownerId: "owner", footer: "Source" });
    now = 10;
    const calls: { content: string; flags: number }[] = [];
    const interaction = {
      customId: `page:${token}:0`,
      user: { id: "owner" },
      reply: async (payload: { content: string; flags: number }) => calls.push(payload),
    };

    await handlePageButton(makeContext(pages), interaction as never);

    expect(calls).toEqual([{ content: "This list has expired. Run the command again.", flags: MessageFlags.Ephemeral }]);
  });
});