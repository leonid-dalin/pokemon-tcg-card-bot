import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { errorCategory } from "./diagnostics.js";

type SqliteDatabase = import("node:sqlite").DatabaseSync;

const requireSqlite = createRequire(import.meta.url);

export type AutoReplyChannelMode = "all" | "selected";

export interface GuildSettings {
  guildId: string;
  messageReplies: boolean;
  decklistReplies: boolean;
  autoReplyChannelMode: AutoReplyChannelMode;
  selectedChannelIds: string[];
  cooldownSeconds: number;
  updatedAt: string;
}

export interface SettingsDefaults {
  messageReplies: boolean;
  decklistReplies: boolean;
  cooldownSeconds: number;
}

export interface GuildSettingsPatch {
  messageReplies?: boolean;
  decklistReplies?: boolean;
  autoReplyChannelMode?: AutoReplyChannelMode;
  selectedChannelIds?: string[];
  cooldownSeconds?: number;
}

const SCHEMA_VERSION = 1;

interface SettingsRow {
  message_replies: number;
  decklist_replies: number;
  auto_reply_channel_mode: string;
  selected_channel_ids: string;
  cooldown_seconds: number;
  updated_at: string;
}

function readRow(guildId: string, row: SettingsRow): GuildSettings {
  let channels: unknown;
  try {
    channels = JSON.parse(row.selected_channel_ids);
  } catch {
    throw new Error(`stored channel list for guild ${guildId} is not valid JSON`);
  }
  if (!Array.isArray(channels) || channels.some((id) => typeof id !== "string")) {
    throw new Error(`stored channel list for guild ${guildId} is not a list of ids`);
  }
  if (row.auto_reply_channel_mode !== "all" && row.auto_reply_channel_mode !== "selected") {
    throw new Error(`stored channel mode for guild ${guildId} is not all or selected`);
  }
  if (!Number.isInteger(row.cooldown_seconds) || row.cooldown_seconds < 0) {
    throw new Error(`stored cooldown for guild ${guildId} is not a number of seconds`);
  }
  return {
    guildId,
    messageReplies: row.message_replies === 1,
    decklistReplies: row.decklist_replies === 1,
    autoReplyChannelMode: row.auto_reply_channel_mode,
    selectedChannelIds: channels as string[],
    cooldownSeconds: row.cooldown_seconds,
    updatedAt: row.updated_at,
  };
}

export class SettingsStore {
  private readonly db: SqliteDatabase;

  constructor(path: string | undefined, private readonly defaults: SettingsDefaults) {
    try {
      const { DatabaseSync } = requireSqlite("node:sqlite") as typeof import("node:sqlite");
      if (path) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      this.db = new DatabaseSync(path ?? ":memory:");
      this.db.exec("PRAGMA busy_timeout = 5000");
    } catch (error) {
      throw new Error(`could not open the settings database (${errorCategory(error)})`);
    }
    this.migrate();
  }

  private migrate(): void {
    const version = (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version > SCHEMA_VERSION) {
      this.db.close();
      throw new Error(`settings database schema version ${version} is newer than this build supports`);
    }
    if (version === SCHEMA_VERSION) {
      const table = this.db
        .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'guild_settings'")
        .get() as { n: number };
      if (table.n !== 1) {
        this.db.close();
        throw new Error("settings database is marked current but the guild_settings table is missing");
      }
      return;
    }
    try {
      this.db.exec("BEGIN");
      this.db.exec(`
        CREATE TABLE guild_settings (
          guild_id TEXT PRIMARY KEY,
          message_replies INTEGER NOT NULL,
          decklist_replies INTEGER NOT NULL,
          auto_reply_channel_mode TEXT NOT NULL,
          selected_channel_ids TEXT NOT NULL,
          cooldown_seconds INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.db.close();
      throw new Error(`could not create the settings schema (${errorCategory(error)})`);
    }
  }

  get(guildId: string): GuildSettings {
    const row = this.db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?").get(guildId) as
      | SettingsRow
      | undefined;
    if (!row) {
      return {
        guildId,
        messageReplies: this.defaults.messageReplies,
        decklistReplies: this.defaults.decklistReplies,
        autoReplyChannelMode: "all",
        selectedChannelIds: [],
        cooldownSeconds: this.defaults.cooldownSeconds,
        updatedAt: "",
      };
    }
    return readRow(guildId, row);
  }

  update(guildId: string, patch: GuildSettingsPatch): GuildSettings {
    if (patch.cooldownSeconds !== undefined && (!Number.isInteger(patch.cooldownSeconds) || patch.cooldownSeconds < 0)) {
      throw new Error("cooldownSeconds must be a number of seconds, zero disables it");
    }
    if (patch.autoReplyChannelMode !== undefined && patch.autoReplyChannelMode !== "all" && patch.autoReplyChannelMode !== "selected") {
      throw new Error("autoReplyChannelMode must be all or selected");
    }
    let saved: GuildSettings | undefined;
    this.db.exec("BEGIN IMMEDIATE");
    let committed = false;
    try {
      const current = this.currentWithinTransaction(guildId);
      const next: GuildSettings = {
        guildId,
        messageReplies: patch.messageReplies ?? current.messageReplies,
        decklistReplies: patch.decklistReplies ?? current.decklistReplies,
        autoReplyChannelMode: patch.autoReplyChannelMode ?? current.autoReplyChannelMode,
        selectedChannelIds: patch.selectedChannelIds ?? current.selectedChannelIds,
        cooldownSeconds: patch.cooldownSeconds ?? current.cooldownSeconds,
        updatedAt: new Date().toISOString(),
      };
      this.db
        .prepare(
          `INSERT INTO guild_settings
             (guild_id, message_replies, decklist_replies, auto_reply_channel_mode, selected_channel_ids, cooldown_seconds, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(guild_id) DO UPDATE SET
             message_replies = excluded.message_replies,
             decklist_replies = excluded.decklist_replies,
             auto_reply_channel_mode = excluded.auto_reply_channel_mode,
             selected_channel_ids = excluded.selected_channel_ids,
             cooldown_seconds = excluded.cooldown_seconds,
             updated_at = excluded.updated_at`,
        )
        .run(
          guildId,
          next.messageReplies ? 1 : 0,
          next.decklistReplies ? 1 : 0,
          next.autoReplyChannelMode,
          JSON.stringify(next.selectedChannelIds),
          next.cooldownSeconds,
          next.updatedAt,
        );
      this.db.exec("COMMIT");
      committed = true;
      saved = next;
    } catch (error) {
      if (!committed) this.db.exec("ROLLBACK");
      throw new Error(`could not save settings for guild ${guildId} (${errorCategory(error)})`);
    }
    return saved!;
  }

  private currentWithinTransaction(guildId: string): GuildSettings {
    const row = this.db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?").get(guildId) as
      | SettingsRow
      | undefined;
    if (!row) {
      return {
        guildId,
        messageReplies: this.defaults.messageReplies,
        decklistReplies: this.defaults.decklistReplies,
        autoReplyChannelMode: "all",
        selectedChannelIds: [],
        cooldownSeconds: this.defaults.cooldownSeconds,
        updatedAt: "",
      };
    }
    return readRow(guildId, row);
  }

  delete(guildId: string): void {
    this.db.prepare("DELETE FROM guild_settings WHERE guild_id = ?").run(guildId);
  }

  close(): void {
    this.db.close();
  }
}
