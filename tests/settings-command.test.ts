import { describe, expect, it, vi } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import type { GuildSettings, GuildSettingsPatch, SettingsStore } from "../src/settings-store.js";
import { handleSettingsCommand } from "../src/discord/settings-command.js";

type Store = SettingsStore & { row: GuildSettings; updates: GuildSettingsPatch[]; deleted: boolean };

function fakeStore(row: Partial<GuildSettings> = {}, failUpdate = false): Store {
  const state: GuildSettings = {
    guildId: "g1",
    messageReplies: true,
    decklistReplies: false,
    autoReplyChannelMode: "all",
    selectedChannelIds: [],
    cooldownSeconds: 30,
    updatedAt: "",
    ...row,
  };
  const store = {
    row: state,
    updates: [] as GuildSettingsPatch[],
    deleted: false,
    get: (id: string) => ({ ...state, guildId: id }),
    update: (_id: string, patch: GuildSettingsPatch) => {
      if (failUpdate) throw new Error("disk full");
      store.updates.push(patch);
      Object.assign(state, patch);
      return { ...state };
    },
    delete: () => {
      store.deleted = true;
    },
    setCurrency: (userId: string, currency: string) => {
      (store as unknown as { userCurrency?: string }).userCurrency = `${userId}:${currency}`;
    },
    clearCurrency: (userId: string) => {
      (store as unknown as { userCurrency?: string }).userCurrency = `${userId}:cleared`;
    },
    setMessageReplies: (userId: string, enabled: boolean) => {
      (store as unknown as { userReplies?: string }).userReplies = `${userId}:${enabled}`;
    },
    clearMessageReplies: (userId: string) => {
      (store as unknown as { userReplies?: string }).userReplies = `${userId}:cleared`;
    },
  };
  return store as unknown as Store;
}

function fakeInteraction(
  sub: string[],
  values: Record<string, unknown> = {},
  overrides: Partial<{ guild: boolean; permissions: string[]; failEdit: boolean }> = {},
  events?: string[],
) {
  const replies: Record<string, unknown>[] = [];
  const inGuild = overrides.guild ?? true;
  const interaction = {
    inGuild: () => inGuild,
    guildId: inGuild ? "g1" : null,
    user: { id: "u1" },
    memberPermissions: {
      has: (flag: unknown) =>
        (overrides.permissions ?? ["ManageGuild"]).some((name) => flag === name || flag === PermissionFlagsBits[name as keyof typeof PermissionFlagsBits]),
    },
    options: {
      getSubcommandGroup: (required?: boolean) => {
        if (sub.length === 2) return sub[0];
        if (required) throw new Error("no group");
        return null;
      },
      getSubcommand: () => sub[sub.length - 1] ?? "view",
      getBoolean: (name: string) => values[name] as boolean,
      getInteger: (name: string) => values[name] as number,
      getString: (name: string) => values[name] as string,
      getChannel: (name: string) => ({ id: values[name] as string }),
    },
    deferReply: async () => {
      events?.push("deferred");
      return {};
    },
    reply: async (payload: Record<string, unknown>) => {
      replies.push(payload);
      return {};
    },
    editReply: async (payload: Record<string, unknown>) => {
      if (overrides.failEdit) throw new Error("delivery failed");
      events?.push("responded");
      replies.push(payload);
      return {};
    },
  };
  return { interaction: interaction as unknown as ChatInputCommandInteraction, replies, events: events ?? [] };
}

const run = (store: Store, interaction: ChatInputCommandInteraction) =>
  handleSettingsCommand({ settings: store, mentionEnabled: true }, interaction);

describe("settings command", () => {
  it("shows the effective settings", async () => {
    const store = fakeStore({ cooldownSeconds: 15, selectedChannelIds: ["111"], autoReplyChannelMode: "selected" });
    const { interaction, replies } = fakeInteraction(["view"]);
    await run(store, interaction);
    const text = replies[0]?.content as string;
    expect(text).toContain("Message replies: on");
    expect(text).toContain("Decklist replies: off");
    expect(text).toContain("<#111>");
    expect(text).toContain("15s");
    expect(text).not.toContain("switched off");
  });

  it("reports a deployment-wide switch that blocks the feature", async () => {
    const store = fakeStore();
    const { interaction, replies } = fakeInteraction(["view"]);
    await handleSettingsCommand({ settings: store, mentionEnabled: false }, interaction);
    expect(replies[0]?.content).toContain("mention replies switched off");
  });

  it("saves a reply switch and confirms only after it succeeds", async () => {
    const store = fakeStore();
    const { interaction, replies } = fakeInteraction(["messages"], { enabled: false });
    await run(store, interaction);
    expect(store.updates).toEqual([{ messageReplies: false }]);
    expect(replies[0]?.content).toContain("Message replies are now off");
  });

  it("sets the server currency from the currency group", async () => {
    const store = fakeStore();
    const { interaction, replies } = fakeInteraction(["currency", "server"], { code: "GBP" });
    await run(store, interaction);
    expect(store.updates).toEqual([{ currency: "GBP" }]);
    expect(replies[0]?.content).toContain("default currency is now pounds");
  });

  it("clears a user currency so the server default applies again", async () => {
    const store = fakeStore();
    const { interaction, replies } = fakeInteraction(["currency", "user"], { code: "default" });
    await run(store, interaction);
    expect((store as unknown as { userCurrency?: string }).userCurrency).toBe("u1:cleared");
    expect(replies[0]?.content).toContain("follow this server's currency");
  });

  it("stores a user currency without touching the server row", async () => {
    const store = fakeStore();
    const { interaction, replies } = fakeInteraction(["currency", "user"], { code: "CNY" });
    await run(store, interaction);
    expect(store.updates).toEqual([]);
    expect((store as unknown as { userCurrency?: string }).userCurrency).toBe("u1:CNY");
    expect(replies[0]?.content).toContain("yuan");
  });

  it("lets a member without Manage Server set their own reply preference", async () => {
    const store = fakeStore();
    const { interaction, replies } = fakeInteraction(["mentions"], { enabled: "off" }, { permissions: [] });
    await run(store, interaction);
    expect((store as unknown as { userReplies?: string }).userReplies).toBe("u1:false");
    expect(replies[0]?.content).toContain("automatic replies are now off");
  });

  it("still refuses server settings to a member without Manage Server", async () => {
    const store = fakeStore();
    const { interaction, replies } = fakeInteraction(["messages"], { enabled: false }, { permissions: [] });
    await run(store, interaction);
    expect(store.updates).toEqual([]);
    expect(replies[0]?.content).toContain("Manage Server");
  });

  it("returns a member to the server reply switch", async () => {
    const store = fakeStore();
    const { interaction, replies } = fakeInteraction(["mentions"], { enabled: "default" });
    await run(store, interaction);
    expect((store as unknown as { userReplies?: string }).userReplies).toBe("u1:cleared");
    expect(replies[0]?.content).toContain("follow this server");
  });

  it("reports a failed save without a success confirmation", async () => {
    const store = fakeStore({}, true);
    const { interaction, replies } = fakeInteraction(["messages"], { enabled: true });
    await run(store, interaction);
    expect(replies[0]?.content).toContain("Could not save");
    expect(replies[0]?.content).not.toContain("now on");
  });

  it("refuses a direct message", async () => {
    const store = fakeStore();
    const { interaction, replies } = fakeInteraction(["view"], {}, { guild: false });
    await run(store, interaction);
    expect(replies[0]?.content).toContain("belong to a server");
    expect(store.updates).toEqual([]);
  });

  it("refuses a member without Manage Server", async () => {
    const store = fakeStore();
    const { interaction, replies } = fakeInteraction(["view"], {}, { permissions: [] });
    await run(store, interaction);
    expect(replies[0]?.content).toContain("Manage Server");
    expect(store.updates).toEqual([]);
  });

  it("manages the channel list and mode", async () => {
    const store = fakeStore();
    let run2 = fakeInteraction(["channels", "add"], { channel: "111" });
    await run(store, run2.interaction);
    expect(store.updates[0]).toEqual({ selectedChannelIds: ["111"] });

    run2 = fakeInteraction(["channels", "add"], { channel: "111" });
    await run(store, run2.interaction);
    expect(run2.replies[0]?.content).toContain("already selected");
    expect(store.updates).toHaveLength(1);

    run2 = fakeInteraction(["channels", "mode"], { mode: "selected" });
    await run(store, run2.interaction);
    expect(store.updates.at(-1)).toEqual({ autoReplyChannelMode: "selected" });

    run2 = fakeInteraction(["channels", "remove"], { channel: "111" });
    await run(store, run2.interaction);
    expect(store.updates.at(-1)).toEqual({ selectedChannelIds: [] });

    run2 = fakeInteraction(["channels", "clear"]);
    await run(store, run2.interaction);
    expect(store.updates.at(-1)).toEqual({ selectedChannelIds: [] });
  });

  it("saves a cooldown of zero to disable it", async () => {
    const store = fakeStore();
    const { interaction, replies } = fakeInteraction(["cooldown"], { seconds: 0 });
    await run(store, interaction);
    expect(store.updates).toEqual([{ cooldownSeconds: 0 }]);
    expect(replies[0]?.content).toContain("off");
  });

  it("resets to the deployment defaults", async () => {
    const store = fakeStore({ decklistReplies: true });
    const { interaction, replies } = fakeInteraction(["reset"]);
    await run(store, interaction);
    expect(store.deleted).toBe(true);
    expect(replies[0]?.content).toContain("reset");
  });

  it("acknowledges the interaction before touching storage", async () => {
    const events: string[] = [];
    const store = fakeStore();
    const original = store.update.bind(store);
    store.update = ((id: string, patch: GuildSettingsPatch) => {
      events.push("saved");
      return original(id, patch);
    }) as typeof store.update;
    const { interaction } = fakeInteraction(["messages"], { enabled: false }, {}, events);
    await run(store, interaction);
    expect(events).toEqual(["deferred", "saved", "responded"]);
  });

  it("does not report a failed confirmation as a failed save", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = fakeStore();
    const { interaction, replies } = fakeInteraction(["messages"], { enabled: false }, { failEdit: true });
    await run(store, interaction);
    expect(store.updates).toEqual([{ messageReplies: false }]);
    expect(replies).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("describes an emptied selected list by the channel mode it leaves behind", async () => {
    const allMode = fakeStore({ autoReplyChannelMode: "all", selectedChannelIds: ["111"] });
    let run2 = fakeInteraction(["channels", "remove"], { channel: "111" });
    await run(allMode, run2.interaction);
    expect(run2.replies[0]?.content).toBe("<#111> removed.");
    expect(run2.replies[0]?.content).not.toContain("off everywhere");

    const selectedMode = fakeStore({ autoReplyChannelMode: "selected", selectedChannelIds: ["111"] });
    run2 = fakeInteraction(["channels", "remove"], { channel: "111" });
    await run(selectedMode, run2.interaction);
    expect(run2.replies[0]?.content).toContain("off everywhere");
  });

  it("shows the card game scope and preferred game", async () => {
    const store = fakeStore({ cardGames: "both", defaultCardGame: "pocket" });
    const { interaction, replies } = fakeInteraction(["view"]);
    await run(store, interaction);
    expect(replies[0]?.content).toContain("both games");
    expect(replies[0]?.content).toContain("Pocket card wins");
  });

  it("saves the allowed games and default game", async () => {
    const store = fakeStore();
    let run2 = fakeInteraction(["games", "allowed"], { games: "pocket" });
    await run(store, run2.interaction);
    expect(store.updates.at(-1)).toEqual({ cardGames: "pocket" });

    run2 = fakeInteraction(["games", "default"], { game: "ptcg" });
    await run(store, run2.interaction);
    expect(run2.replies[0]?.content).toContain("both games are allowed");
    expect(store.updates).toHaveLength(1);

    run2 = fakeInteraction(["games", "allowed"], { games: "both" });
    await run(store, run2.interaction);
    run2 = fakeInteraction(["games", "default"], { game: "ptcg" });
    await run(store, run2.interaction);
    expect(store.updates.at(-1)).toEqual({ defaultCardGame: "ptcg" });
  });
});
