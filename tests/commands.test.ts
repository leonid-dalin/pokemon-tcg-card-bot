import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { handlePrintingButton } from "../src/discord/commands.js";

const context = {
  client: new TcgdexClient({ retries: 0 }),
  attribution: "Card data from TCGdex",
  energyEmoji: {},
};

afterEach(() => vi.unstubAllGlobals());

describe("handlePrintingButton", () => {
  it("refuses a printing press from another user", async () => {
    const calls: { type: string; payload?: { content: string; flags: number } }[] = [];
    const interaction = {
      customId: "printing:sv06-130:owner",
      user: { id: "other" },
      reply: async (payload: { content: string; flags: number }) => calls.push({ type: "reply", payload }),
      deferUpdate: async () => calls.push({ type: "defer" }),
      editReply: async () => calls.push({ type: "edit" }),
    };

    await handlePrintingButton(context, interaction as never);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.type).toBe("reply");
    expect(calls[0]?.payload?.content).toBe("Only the person who asked can change this. Ask for your own copy with [[name]] or /card.");
    expect(calls[0]?.payload?.flags).toBe(MessageFlags.Ephemeral);
  });

  it("lets anyone use a legacy ownerless button", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404, json: async () => ({}) }));
    const calls: string[] = [];
    const interaction = {
      customId: "printing:b4-212",
      user: { id: "anyone" },
      deferUpdate: async () => calls.push("defer"),
      editReply: async (payload: { embeds: unknown[] }) => calls.push(`edit:${payload.embeds.length}`),
    };

    await handlePrintingButton(context, interaction as never);

    expect(calls).toEqual(["defer", "edit:1"]);
  });
});