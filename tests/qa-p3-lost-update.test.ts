import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { baselineOf } from "../src/discord/settings-controller.js";
import { SettingsPanelController } from "../src/discord/settings-controller.js";
import { SettingsSessions } from "../src/discord/settings-session.js";
import { SettingsStore } from "../src/settings-store.js";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "qa-q1-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function panel(store: SettingsStore, sessions: SettingsSessions, id: string) {
  const controller = new SettingsPanelController(store, true, sessions);
  const press = async (action: string, values: string[] = []) => {
    const calls: unknown[] = [];
    await controller.handleComponent({
      user: { id: "admin" }, guildId: "g1", channelId: "c", customId: `st:${action}:${id}`, values,
      inGuild: () => true, memberPermissions: { has: () => true },
      update: async (payload) => void calls.push(payload), reply: async (payload) => void calls.push(payload),
      editReply: async (payload) => void calls.push(payload), followUp: async (payload) => void calls.push(payload),
      deferUpdate: async () => {}, deferReply: async () => {}, showModal: () => {},
    } as never);
    return calls;
  };
  return press;
}

function setup() {
  const store = new SettingsStore(join(scratch, `${Math.random().toString(36).slice(2)}.db`), {
    messageReplies: true, decklistReplies: false, cooldownSeconds: 0,
  });
  const sessions = new SettingsSessions();
  const session = sessions.open("admin", "g1", "server", "overview", baselineOf(store.get("g1")));
  return { store, sessions, id: session.id };
}

describe("Q1 stale channel drafts cannot overwrite another admin", () => {
  for (const transition of ["scope", "refresh"]) {
    it(`keeps the other admin's channel after ${transition}`, async () => {
      const a = "110000000000000001";
      const b = "110000000000000002";
      const { store, sessions, id } = setup();
      store.update("g1", { selectedChannelIds: [a], autoReplyChannelMode: "selected" });
      const press = panel(store, sessions, id);
      await press("nav", ["channels"]);
      if (transition === "scope") await press("scope:personal");
      store.update("g1", { selectedChannelIds: [b] });
      if (transition === "scope") await press("scope:server");
      else await press("refresh");
      const calls = await press(transition === "scope" ? "ch:selected" : "ch:save");
      const text = JSON.stringify(calls);
      expect(text).toContain("changed while");
      expect(store.get("g1").selectedChannelIds).toEqual([b]);
      store.close();
    });
  }

  it("keeps the second admin's channel after conflict recovery", async () => {
    const a = "110000000000000001";
    const b = "110000000000000002";
    const { store, sessions, id } = setup();
    store.update("g1", { selectedChannelIds: [a], autoReplyChannelMode: "selected" });
    const press = panel(store, sessions, id);
    await press("nav", ["channels"]);
    store.update("g1", { selectedChannelIds: [b] });
    const conflict = await press("ch:selected");
    expect(JSON.stringify(conflict)).toContain("changed while");
    store.update("g1", { selectedChannelIds: [a] });
    await press("refresh");
    const save = await press("ch:save");
    expect(JSON.stringify(save)).toContain("changed while");
    expect(store.get("g1").selectedChannelIds).toEqual([a]);
    store.close();
  });

  it("allows the next legitimate write after navigating to Currency", async () => {
    const { store, sessions, id } = setup();
    store.update("g1", { currency: "GBP" });
    const press = panel(store, sessions, id);
    await press("nav", ["currency"]);
    await press("set:currency", ["USD"]);
    expect(store.get("g1").currency).toBe("USD");
    store.close();
  });
});
