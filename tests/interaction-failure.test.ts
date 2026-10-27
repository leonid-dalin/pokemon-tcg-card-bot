import { MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { reportInteractionFailure } from "../src/discord/interaction-failure.js";

function fakeInteraction(state: { deferred: boolean; replied: boolean; command: boolean }) {
  const sent: { via: string; payload: unknown }[] = [];
  const interaction = {
    ...state,
    isRepliable: () => true,
    isChatInputCommand: () => state.command,
    reply: async (payload: unknown) => void sent.push({ via: "reply", payload }),
    editReply: async (payload: unknown) => void sent.push({ via: "editReply", payload }),
    followUp: async (payload: unknown) => void sent.push({ via: "followUp", payload }),
  };
  return { interaction, sent };
}

describe("reportInteractionFailure", () => {
  it.each([
    { name: "fresh command", deferred: false, replied: false, command: true, via: "reply" },
    { name: "deferred command", deferred: true, replied: false, command: true, via: "editReply" },
    { name: "deferred button", deferred: true, replied: false, command: false, via: "followUp" },
    { name: "answered command", deferred: true, replied: true, command: true, via: "followUp" },
  ])("answers a $name through $via", async ({ deferred, replied, command, via }) => {
    const { interaction, sent } = fakeInteraction({ deferred, replied, command });
    await reportInteractionFailure(interaction as never);
    expect(sent.map((entry) => entry.via)).toEqual([via]);
  });

  it("keeps the notice private unless it replaces the deferred reply", async () => {
    const { interaction, sent } = fakeInteraction({ deferred: true, replied: false, command: false });
    await reportInteractionFailure(interaction as never);
    expect(sent[0]?.payload).toMatchObject({ flags: MessageFlags.Ephemeral });
  });

  it("stays silent for an interaction that cannot be answered", async () => {
    const { interaction, sent } = fakeInteraction({ deferred: false, replied: false, command: false });
    await reportInteractionFailure({ ...interaction, isRepliable: () => false } as never);
    expect(sent).toEqual([]);
  });
});
