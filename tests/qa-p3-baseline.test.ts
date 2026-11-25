import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SettingsPanelController, baselineOf } from "../src/discord/settings-controller.js";
import { SettingsSessions } from "../src/discord/settings-session.js";
import { SettingsStore } from "../src/settings-store.js";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "qa-p3-baseline-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function interaction(customId: string, values: string[] = []) {
  const calls: string[] = [];
  return {
    calls,
    value: {
      user: { id: "owner" }, guildId: "g1", channelId: "c1", customId, values,
      memberPermissions: { has: () => true }, inGuild: () => true,
      update: async () => void calls.push("update"),
      reply: async () => void calls.push("reply"),
      editReply: async () => void calls.push("editReply"),
      followUp: async () => void calls.push("followUp"),
      deferUpdate: async () => void calls.push("deferUpdate"),
      deferReply: async () => void calls.push("deferReply"),
      showModal: () => void calls.push("showModal"),
    },
  };
}

describe("P3 session baseline after showing fresh settings", () => {
  it("accepts the next legitimate write after a refresh", async () => {
    const store = new SettingsStore(join(scratch, "baseline.db"), { messageReplies: true, decklistReplies: false, cooldownSeconds: 0 });
    const sessions = new SettingsSessions();
    const controller = new SettingsPanelController(store, true, sessions);
    const session = sessions.open("owner", "g1", "server", "overview", baselineOf(store.get("g1")));

    store.update("g1", { currency: "GBP" });
    const refresh = interaction(`st:refresh:${session.id}`);
    await controller.handleComponent(refresh.value as never);
    expect(session.baseline).toBe(baselineOf(store.get("g1")));

    const write = interaction(`st:set:currency:${session.id}`, ["USD"]);
    await controller.handleComponent(write.value as never);
    expect(store.get("g1").currency).toBe("USD");
    expect(write.calls).toContain("update");
    store.close();
  });
});
