import { describe, expect, it } from "vitest";
import { OverloadedError } from "../src/api/limiter.js";
import { FAILURE, SETTINGS_FAILURE, reportInteractionFailure } from "../src/discord/interaction-failure.js";

function fake(options: { customId?: string; commandName?: string; deferred?: boolean }) {
  const sent: { how: string; content: string }[] = [];
  const isCommand = options.commandName !== undefined;
  const interaction = {
    isAutocomplete: () => false,
    isRepliable: () => true,
    isChatInputCommand: () => isCommand,
    commandName: options.commandName,
    customId: options.customId,
    deferred: options.deferred ?? false,
    replied: false,
    reply: async (payload: { content: string }) => void sent.push({ how: "reply", content: payload.content }),
    editReply: async (payload: { content: string }) => void sent.push({ how: "editReply", content: payload.content }),
    followUp: async (payload: { content: string }) => void sent.push({ how: "followUp", content: payload.content }),
  };
  return { interaction: interaction as never, sent };
}

describe("reportInteractionFailure wording", () => {
  it("answers a failed settings control with settings wording", async () => {
    const { interaction, sent } = fake({ customId: "st:set:cooldown:sess" });
    await reportInteractionFailure(interaction, new Error("could not save settings"));
    expect(sent).toEqual([{ how: "reply", content: SETTINGS_FAILURE }]);
  });

  it("answers a failed card button with card wording", async () => {
    const { interaction, sent } = fake({ customId: "page:tok:1" });
    await reportInteractionFailure(interaction, new Error("boom"));
    expect(sent).toEqual([{ how: "reply", content: FAILURE }]);
  });

  it("answers a failed /settings command with settings wording", async () => {
    const { interaction, sent } = fake({ commandName: "settings", deferred: true });
    await reportInteractionFailure(interaction, new Error("boom"));
    expect(sent).toEqual([{ how: "editReply", content: SETTINGS_FAILURE }]);
  });

  it("lets an explicit message win over the interaction's default", async () => {
    const { interaction, sent } = fake({ customId: "page:tok:1" });
    await reportInteractionFailure(interaction, new Error("boom"), "custom");
    expect(sent).toEqual([{ how: "reply", content: "custom" }]);
  });

  it("still reports overload as a busy hint on a settings control", async () => {
    const { interaction, sent } = fake({ customId: "st:set:cooldown:sess" });
    await reportInteractionFailure(interaction, new OverloadedError("queue-full"));
    expect(sent[0]?.content).toContain("busy");
  });
});
