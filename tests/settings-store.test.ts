import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsStore } from "../src/settings-store.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const dirs: string[] = [];

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "settings-"));
  dirs.push(dir);
  return join(dir, "settings.db");
}

const DEFAULTS = { messageReplies: true, decklistReplies: false, cooldownSeconds: 30 };

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SettingsStore", () => {
  it("falls back to the deployment defaults for guilds without overrides", () => {
    const store = new SettingsStore(undefined, DEFAULTS);
    const settings = store.get("g1");
    expect(settings).toMatchObject({
      guildId: "g1",
      messageReplies: true,
      decklistReplies: false,
      autoReplyChannelMode: "all",
      selectedChannelIds: [],
      cooldownSeconds: 30,
    });
  });

  it("keeps settings across a close and reopen of a file database", () => {
    const path = tempPath();
    const first = new SettingsStore(path, DEFAULTS);
    first.update("g1", { decklistReplies: true, cooldownSeconds: 0 });
    first.close();

    const second = new SettingsStore(path, DEFAULTS);
    expect(second.get("g1")).toMatchObject({ decklistReplies: true, cooldownSeconds: 0 });
    second.close();
    expect(existsSync(path)).toBe(true);
  });

  it("keeps two guilds isolated", () => {
    const store = new SettingsStore(undefined, DEFAULTS);
    store.update("g1", { decklistReplies: true });
    store.update("g2", { messageReplies: false, cooldownSeconds: 5 });
    expect(store.get("g1")).toMatchObject({ decklistReplies: true, messageReplies: true, cooldownSeconds: 30 });
    expect(store.get("g2")).toMatchObject({ decklistReplies: false, messageReplies: false, cooldownSeconds: 5 });
  });

  it("preserves both fields of a partial update", () => {
    const store = new SettingsStore(undefined, DEFAULTS);
    store.update("g1", { cooldownSeconds: 10 });
    store.update("g1", { decklistReplies: true });
    const settings = store.get("g1");
    expect(settings.cooldownSeconds).toBe(10);
    expect(settings.decklistReplies).toBe(true);
  });

  it("stores selected channel ids as strings", () => {
    const store = new SettingsStore(undefined, DEFAULTS);
    store.update("g1", { autoReplyChannelMode: "selected", selectedChannelIds: ["111", "222"] });
    expect(store.get("g1").selectedChannelIds).toEqual(["111", "222"]);
  });

  it("deletes a guild's settings", () => {
    const store = new SettingsStore(undefined, DEFAULTS);
    store.update("g1", { decklistReplies: true });
    store.delete("g1");
    expect(store.get("g1").decklistReplies).toBe(false);
    store.close();
  });

  it("refuses to open a database with a newer schema", () => {
    const path = tempPath();
    const store = new SettingsStore(path, DEFAULTS);
    store.update("g1", { decklistReplies: true });
    store.close();
    new DatabaseSync(path).close();
    const raw = new DatabaseSync(path);
    raw.exec("PRAGMA user_version = 99");
    raw.close();

    expect(() => new SettingsStore(path, DEFAULTS)).toThrow("newer than this build supports");
    const check = new DatabaseSync(path);
    expect(check.prepare("PRAGMA user_version").get()).toEqual({ user_version: 99 });
    check.close();
  });

  it("refuses a database marked current without its table", () => {
    const path = tempPath();
    const raw = new DatabaseSync(path);
    raw.exec("PRAGMA user_version = 1");
    raw.close();
    expect(() => new SettingsStore(path, DEFAULTS)).toThrow("guild_settings table is missing");
  });

  it("rejects malformed stored rows instead of falling back to defaults", () => {
    const path = tempPath();
    const store = new SettingsStore(path, DEFAULTS);
    store.update("g1", { decklistReplies: true });
    store.close();

    const raw = new DatabaseSync(path);
    raw.prepare("UPDATE guild_settings SET selected_channel_ids = 'not json' WHERE guild_id = ?").run("g1");
    raw.close();

    const reopened = new SettingsStore(path, DEFAULTS);
    try {
      expect(() => reopened.get("g1")).toThrow("not valid JSON");
    } finally {
      reopened.close();
    }
  });

  it("rejects an invalid patch before touching the database", () => {
    const store = new SettingsStore(undefined, DEFAULTS);
    expect(() => store.update("g1", { cooldownSeconds: -1 })).toThrow("seconds");
    expect(() => store.update("g1", { autoReplyChannelMode: "sometimes" as never })).toThrow("all or selected");
    expect(store.get("g1").cooldownSeconds).toBe(30);
  });
});
