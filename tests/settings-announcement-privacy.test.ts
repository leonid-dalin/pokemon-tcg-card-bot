import { describe, expect, it } from "vitest";
import { baselineOf, SettingsPanelController } from "../src/discord/settings-controller.js";
import { SettingsSessions } from "../src/discord/settings-session.js";

/** A committed channel change may announce counts, never channel identities. */
describe("settings announcements", () => {
  it("keeps channel ids out of the public announcement", async () => {
    const announcements: string[][] = [];
    const settings = {
      selectedChannelIds: ["111111111111111111"],
      autoReplyChannelMode: "selected",
      messageReplies: true,
      decklistReplies: true,
      cooldownSeconds: 0,
      cardGames: {},
      defaultCardGame: "",
      currency: "",
    };
    const store = { get: () => ({ ...settings }), update: (_guildId: string, patch: object) => void Object.assign(settings, patch) };
    const sessions = new SettingsSessions();
    const controller = new SettingsPanelController(
      store as never,
      true,
      sessions,
      async (_guildId, _channelId, lines) => void announcements.push(lines),
    );
    const session = sessions.open("user-1", "guild-1", "server", "channels", baselineOf(settings as never));
    session.draftChannelIds = ["222222222222222222", "333333333333333333"];
    sessions.update(session);

    const interaction = {
      guildId: "guild-1",
      user: { id: "user-1" },
      channelId: "444444444444444444",
      customId: `st:ch:save:${session.id}`,
      inGuild: () => true,
      memberPermissions: { has: () => true },
      values: [],
      deferred: false,
      replied: false,
      reply: async () => {},
      followUp: async () => {},
      deferReply: async () => {},
      editReply: async () => {},
      update: async () => {},
    };
    await controller.handleComponent(interaction as never);

    const announced = announcements.flat().join("\n");
    expect(announcements).toHaveLength(1);
    expect(announced).not.toMatch(/<#\d+>/);
    expect(announced).toContain("2 selected");
  });
});
