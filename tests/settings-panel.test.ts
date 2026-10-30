import { describe, expect, it, vi } from "vitest";
import type { GuildSettings } from "../src/settings-store.js";
import { SettingsPanelController, baselineOf } from "../src/discord/settings-controller.js";
import { SettingsSessions } from "../src/discord/settings-session.js";

function store(row: Partial<GuildSettings> = {}) {
  const state: GuildSettings = {
    guildId: "guild-a",
    messageReplies: true,
    decklistReplies: false,
    autoReplyChannelMode: "all",
    selectedChannelIds: [],
    cooldownSeconds: 0,
    cardGames: "both",
    defaultCardGame: "ptcg",
    currency: undefined,
    updatedAt: "",
    updates: [] as unknown[],
    ...row,
  };
  return {
    state,
    updates: [] as Partial<GuildSettings>[],
    get: () => ({ ...state, selectedChannelIds: [...state.selectedChannelIds] }),
    update: (guildId: string, patch: Partial<GuildSettings>) => {
      Object.assign(state, patch);
      state.updatedAt = "";
      state.updates.push(patch);
    },
    delete: () => {
      Object.assign(state, {
        messageReplies: true, decklistReplies: false, autoReplyChannelMode: "all",
        selectedChannelIds: [], cooldownSeconds: 0, cardGames: "both", defaultCardGame: "ptcg", currency: undefined,
      });
    },
    messageRepliesFor: () => undefined,
    currencyFor: () => undefined,
    setCurrency: () => undefined,
    clearCurrency: () => undefined,
    setMessageReplies: () => undefined,
    clearMessageReplies: () => undefined,
  };
}

interface Fixture {
  controller: SettingsPanelController;
  sessions: SettingsSessions;
  recorded: string[][];
  interaction: (customId: string, options?: { values?: string[]; admin?: boolean }) => { interaction: unknown };
}

function fixture(row: Partial<GuildSettings> = {}): Fixture {
  const recorded: string[][] = [];
  const sessions = new SettingsSessions();
  const settingsStore = store(row);
  const controller = new SettingsPanelController(
    settingsStore as never,
    true,
    sessions,
    async (guildId, channelId, lines) => void recorded.push([guildId, channelId, ...lines]),
  );
  const interaction = (customId: string, options: { values?: string[]; admin?: boolean } = {}) => {
    const sent: unknown[] = [];
    const updates: unknown[] = [];
    const modals: string[] = [];
    return {
      sent,
      updates,
      modals,
      interaction: {
        user: { id: "member-1" },
        guildId: "guild-a",
        channelId: "channel-1",
        customId,
        memberPermissions: { has: () => options.admin ?? false },
        inGuild: () => true,
        values: options.values,
        reply: async () => undefined,
        editReply: async () => undefined,
        followUp: async () => undefined,
        deferUpdate: async () => undefined,
        showModal: (modal: { customId: string }) => void modals.push(modal.customId),
        channel: { isTextBased: () => true, send: async () => undefined },
      },
    };
  };
  return { controller, sessions, recorded, interaction };
}

function openServerPanel(fixture: Fixture): string {
  const session = fixture.sessions.open("member-1", "guild-a", "server", "overview", baselineOf(fixtureStoreState(fixture)));
  return session.id;
}

function fixtureStoreState(fixture: Fixture): GuildSettings {
  return (fixture.controller as unknown as { store: { get(): GuildSettings } }).store.get();
}

describe("settings panel permissions", () => {
  it("refuses a server field change from a non-admin", async () => {
    const fx = fixture();
    const sessionId = openServerPanel(fx);
    const { interaction } = fx.interaction(`st:set:messages:on:${sessionId}`, { admin: false });
    await fx.controller.handleComponent(interaction as never);
    expect(fx.recorded).toEqual([]);
  });
});

describe("settings panel server changes", () => {
  it("saves a reply switch, announces it, and re-renders", async () => {
    const fx = fixture({ messageReplies: false });
    const sessionId = openServerPanel(fx);
    const { interaction } = fx.interaction(`st:set:messages:on:${sessionId}`, { admin: true });
    await fx.controller.handleComponent(interaction as never);
    expect(fx.recorded).toEqual([["guild-a", "channel-1", "Message replies: Off -> On"]]);
    expect(fxStore(fx).messageReplies).toBe(true);
  });

  it("saves a cooldown preset from the select", async () => {
    const fx = fixture();
    const sessionId = openServerPanel(fx);
    const { interaction } = fx.interaction(`st:set:cooldown:${sessionId}`, { values: ["30"], admin: true });
    await fx.controller.handleComponent(interaction as never);
    expect(fx.recorded).toEqual([["guild-a", "channel-1", "Reply cooldown: Off -> 30s"]]);
    expect(fxStore(fx).cooldownSeconds).toBe(30);
  });

  it("saves card games and the preferred game", async () => {
    const fx = fixture();
    const sessionId = openServerPanel(fx);
    await fx.controller.handleComponent(fx.interaction(`st:set:games:${sessionId}`, { values: ["pocket"], admin: true }).interaction as never);
    await fx.controller.handleComponent(fx.interaction(`st:set:defaultgame:${sessionId}`, { values: ["pocket"], admin: true }).interaction as never);
    expect(fx.recorded).toEqual([
      ["guild-a", "channel-1", "Card games: both -> pocket"],
      ["guild-a", "channel-1", "Preferred game: ptcg -> pocket"],
    ]);
  });

  it("saves the server currency", async () => {
    const fx = fixture();
    const sessionId = openServerPanel(fx);
    await fx.controller.handleComponent(fx.interaction(`st:set:currency:${sessionId}`, { values: ["GBP"], admin: true }).interaction as never);
    expect(fx.recorded).toEqual([["guild-a", "channel-1", "Server default currency: EUR -> GBP"]]);
    expect(fxStore(fx).currency).toBe("GBP");
  });

  it("changes the channel mode and announces it", async () => {
    const fx = fixture();
    const sessionId = openServerPanel(fx);
    await fx.controller.handleComponent(fx.interaction(`st:ch:selected:${sessionId}`, { admin: true }).interaction as never);
    expect(fx.recorded).toEqual([["guild-a", "channel-1", "Automatic-reply channels: Everywhere -> Selected channels"]]);
  });

  it("resets the server after confirmation and keeps personal rows", async () => {
    const fx = fixture({ cooldownSeconds: 45 });
    const sessionId = openServerPanel(fx);
    await fx.controller.handleComponent(fx.interaction(`st:reset:confirm:${sessionId}`, { admin: true }).interaction as never);
    expect(fx.recorded[0]?.slice(2).join("\n")).toContain("Server settings were reset");
    expect(fxStore(fx).cooldownSeconds).toBe(0);
  });
});

describe("settings panel channels draft", () => {
  it("collects picker values into the draft without saving", async () => {
    const fx = fixture();
    const sessionId = openServerPanel(fx);
    await fx.controller.handleComponent(fx.interaction(`st:ch:add:${sessionId}`, { values: ["ch-1", "ch-2"], admin: true }).interaction as never);
    expect(fx.recorded).toEqual([]);
  });

  it("saves the draft as the selected list", async () => {
    const fx = fixture();
    const sessionId = openServerPanel(fx);
    await fx.controller.handleComponent(fx.interaction(`st:ch:add:${sessionId}`, { values: ["ch-1"], admin: true }).interaction as never);
    await fx.controller.handleComponent(fx.interaction(`st:ch:save:${sessionId}`, { admin: true }).interaction as never);
    expect(fx.recorded).toEqual([["guild-a", "channel-1", "Automatic-reply channels: Everywhere -> 1 selected"]]);
    expect(fxStore(fx).selectedChannelIds).toEqual(["ch-1"]);
  });
});

describe("settings panel personal preferences", () => {
  it("does not announce a personal currency change", async () => {
    const fx = fixture();
    const sessionId = fx.sessions.open("member-1", "guild-a", "personal", "personal", baselineOf(fxStoreState(fx)));
    await fx.controller.handleComponent(fx.interaction(`st:my:currency:${sessionId}`, { values: ["USD"], admin: false }).interaction as never);
    expect(fx.recorded).toEqual([]);
  });
});

function fxStore(fx: Fixture): GuildSettings {
  return (fixture as unknown as { controller: { store: never } } && fxStoreState(fx));
}

function fxStoreState(fx: Fixture): GuildSettings {
  return (fx.controller as unknown as { store: { get(): GuildSettings } }).store.get();
}
