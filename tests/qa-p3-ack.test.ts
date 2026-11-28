import { describe, expect, it } from "vitest";
import type { Card } from "../src/api/types.js";
import { handleOpenCardMenu } from "../src/discord/commands.js";
import { PageStore } from "../src/discord/pages.js";

const card = { id: "swsh11-062", name: "Clefairy" } as Card;
const client = {
  getCard: async () => card,
  searchByName: async () => [{ id: card.id, name: card.name }],
} as never;

function press() {
  const calls: string[] = [];
  return {
    calls,
    interaction: {
      customId: "open:miss0:owner",
      values: [card.id],
      message: { id: "sequential-miss" },
      guildId: "g1", channelId: "c1", user: { id: "owner" },
      deferUpdate: async () => void calls.push("deferUpdate"),
      editReply: async () => void calls.push("editReply"),
      reply: async () => void calls.push("reply"),
      followUp: async () => void calls.push("followUp"),
    } as never,
  };
}

describe("P3 sequential miss press", () => {
  it("acknowledges a second press after the menu converted", async () => {
    const context = { client, attribution: "TCGdex", energyEmoji: {}, pages: new PageStore(), cleanup: { schedule: () => {}, cancel: () => {} } } as never;
    const first = press();
    await handleOpenCardMenu(context, first.interaction);
    expect(first.calls).toContain("deferUpdate");
    const second = press();
    await handleOpenCardMenu(context, second.interaction);
    expect(second.calls).toContain("deferUpdate");
  });
});
