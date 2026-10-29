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
  cardGames: CardGameScope;
  defaultCardGame: CardGameDefault;
  currency: Currency | undefined;
  updatedAt: string;
}

export interface SettingsDefaults {
  messageReplies: boolean;
  decklistReplies: boolean;
  cooldownSeconds: number;
}

export type CardGameScope = "ptcg" | "pocket" | "both";
export type CardGameDefault = "ptcg" | "pocket";

export interface GuildSettingsPatch {
  messageReplies?: boolean;
  decklistReplies?: boolean;
  autoReplyChannelMode?: AutoReplyChannelMode;
  selectedChannelIds?: string[];
  cooldownSeconds?: number;
  cardGames?: CardGameScope;
  defaultCardGame?: CardGameDefault;
  currency?: Currency;
}

const SCHEMA_VERSION = 3;
const CARD_GAME_SCOPES: CardGameScope[] = ["ptcg", "pocket", "both"];
const CARD_GAME_DEFAULTS: CardGameDefault[] = ["ptcg", "pocket"];
export const DEFAULT_CARD_GAMES: CardGameScope = "both";
export const DEFAULT_CARD_GAME: CardGameDefault = "ptcg";

export type Currency = "EUR" | "USD" | "GBP" | "JPY" | "CNY";
export const CURRENCIES: Currency[] = ["EUR", "USD", "GBP", "JPY", "CNY"];
export const DEFAULT_CURRENCY: Currency = "EUR";

export interface UserSettings {
  userId: string;
  currency: Currency;
  updatedAt: string;
}

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
};

/** Formats an amount with the currency's symbol; JPY has no minor unit. */
export function formatMoney(amount: number, currency: Currency): string {
  const digits = currency === "JPY" ? 0 : 2;
  return `${CURRENCY_SYMBOLS[currency]}${amount.toFixed(digits)}`;
}

interface SettingsRow {
  message_replies: number;
  decklist_replies: number;
  auto_reply_channel_mode: string;
  selected_channel_ids: string;
  cooldown_seconds: number;
  card_games: string;
  default_card_game: string;
  currency: string | null;
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
  if (!CARD_GAME_SCOPES.includes(row.card_games as CardGameScope)) {
    throw new Error(`stored card game scope for guild ${guildId} is not ptcg, pocket or both`);
  }
  if (!CARD_GAME_DEFAULTS.includes(row.default_card_game as CardGameDefault)) {
    throw new Error(`stored default card game for guild ${guildId} is not ptcg or pocket`);
  }
  if (row.currency !== null && !CURRENCIES.includes(row.currency as Currency)) {
    throw new Error(`stored currency for guild ${guildId} is not a supported currency`);
  }
  return {
    guildId,
    messageReplies: row.message_replies === 1,
    decklistReplies: row.decklist_replies === 1,
    autoReplyChannelMode: row.auto_reply_channel_mode,
    selectedChannelIds: channels as string[],
    cooldownSeconds: row.cooldown_seconds,
    cardGames: row.card_games as CardGameScope,
    defaultCardGame: row.default_card_game as CardGameDefault,
    currency: (row.currency as Currency | null) ?? undefined,
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
      const tables = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('guild_settings', 'user_settings')")
        .all() as { name: string }[];
      const names = new Set(tables.map((row) => row.name));
      if (!names.has("guild_settings")) {
        this.db.close();
        throw new Error("settings database is marked current but the guild_settings table is missing");
      }
      if (!names.has("user_settings")) {
        this.db.close();
        throw new Error("settings database is marked current but the user_settings table is missing");
      }
      return;
    }
    try {
      this.db.exec("BEGIN");
      if (version === 0) {
        this.db.exec(`
          CREATE TABLE guild_settings (
            guild_id TEXT PRIMARY KEY,
            message_replies INTEGER NOT NULL,
            decklist_replies INTEGER NOT NULL,
            auto_reply_channel_mode TEXT NOT NULL,
            selected_channel_ids TEXT NOT NULL,
            cooldown_seconds INTEGER NOT NULL,
            card_games TEXT NOT NULL DEFAULT 'both',
            default_card_game TEXT NOT NULL DEFAULT 'ptcg',
            currency TEXT,
            updated_at TEXT NOT NULL
          )
        `);
      } else if (version === 1) {
        this.db.exec("ALTER TABLE guild_settings ADD COLUMN card_games TEXT NOT NULL DEFAULT 'both'");
        this.db.exec("ALTER TABLE guild_settings ADD COLUMN default_card_game TEXT NOT NULL DEFAULT 'ptcg'");
      }
      if (version <= 2) {
        const columns = this.db.prepare("PRAGMA table_info(guild_settings)").all() as { name: string }[];
        if (!columns.some((column) => column.name === "currency")) {
          this.db.exec("ALTER TABLE guild_settings ADD COLUMN currency TEXT");
        }
      }
      if (version <= 2) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS user_settings (
            user_id TEXT PRIMARY KEY,
            currency TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `);
      }
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
        cardGames: DEFAULT_CARD_GAMES,
        defaultCardGame: DEFAULT_CARD_GAME,
        currency: undefined,
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
    if (patch.cardGames !== undefined && !CARD_GAME_SCOPES.includes(patch.cardGames)) {
      throw new Error("cardGames must be ptcg, pocket or both");
    }
    if (patch.defaultCardGame !== undefined && !CARD_GAME_DEFAULTS.includes(patch.defaultCardGame)) {
      throw new Error("defaultCardGame must be ptcg or pocket");
    }
    if (patch.currency !== undefined && !CURRENCIES.includes(patch.currency)) {
      throw new Error("currency must be EUR, USD, GBP, JPY or CNY");
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
        cardGames: patch.cardGames ?? current.cardGames,
        defaultCardGame: patch.defaultCardGame ?? current.defaultCardGame,
        currency: patch.currency ?? current.currency,
        updatedAt: new Date().toISOString(),
      };
      this.db
        .prepare(
          `INSERT INTO guild_settings
             (guild_id, message_replies, decklist_replies, auto_reply_channel_mode, selected_channel_ids, cooldown_seconds, card_games, default_card_game, currency, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(guild_id) DO UPDATE SET
             message_replies = excluded.message_replies,
             decklist_replies = excluded.decklist_replies,
             auto_reply_channel_mode = excluded.auto_reply_channel_mode,
             selected_channel_ids = excluded.selected_channel_ids,
             cooldown_seconds = excluded.cooldown_seconds,
             card_games = excluded.card_games,
             default_card_game = excluded.default_card_game,
             currency = excluded.currency,
             updated_at = excluded.updated_at`,
        )
        .run(
          guildId,
          next.messageReplies ? 1 : 0,
          next.decklistReplies ? 1 : 0,
          next.autoReplyChannelMode,
          JSON.stringify(next.selectedChannelIds),
          next.cooldownSeconds,
          next.cardGames,
          next.defaultCardGame,
          next.currency ?? null,
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
        cardGames: DEFAULT_CARD_GAMES,
        defaultCardGame: DEFAULT_CARD_GAME,
        currency: undefined,
        updatedAt: "",
      };
    }
    return readRow(guildId, row);
  }

  delete(guildId: string): void {
    this.db.prepare("DELETE FROM guild_settings WHERE guild_id = ?").run(guildId);
  }

  /** Returns the user's stored currency, or undefined when they have not chosen one. */
  currencyFor(userId: string): Currency | undefined {
    const row = this.db.prepare("SELECT currency FROM user_settings WHERE user_id = ?").get(userId) as
      | { currency: string }
      | undefined;
    if (!row) return undefined;
    if (!CURRENCIES.includes(row.currency as Currency)) {
      throw new Error(`stored currency for user ${userId} is not a supported currency`);
    }
    return row.currency as Currency;
  }

  setCurrency(userId: string, currency: Currency): UserSettings {
    if (!CURRENCIES.includes(currency)) {
      throw new Error("currency must be EUR, USD, GBP, JPY or CNY");
    }
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO user_settings (user_id, currency, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET currency = excluded.currency, updated_at = excluded.updated_at`,
      )
      .run(userId, currency, updatedAt);
    return { userId, currency, updatedAt };
  }

  /** Resolves the currency for a lookup: the user's choice, then the server default, then EUR. */
  resolveCurrency(userId: string, guildId: string | null): Currency {
    const user = this.currencyFor(userId);
    if (user) return user;
    if (guildId) {
      const server = this.get(guildId).currency;
      if (server) return server;
    }
    return DEFAULT_CURRENCY;
  }

  close(): void {
    this.db.close();
  }
}
