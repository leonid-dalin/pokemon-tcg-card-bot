import { DEFAULT_ATTRIBUTION } from "./render.js";

export interface Config {
  token: string;
  clientId: string;
  guildId?: string;
  mentionEnabled: boolean;
  /** Enables decklist replies to pasted lists. */
  decklistEnabled: boolean;
  /** 0 disables the throttle entirely. */
  mentionCooldownSeconds: number;
  attribution: string;
  energyEmoji: Record<string, string>;
  invocationLogDir?: string;
  invocationLogRetentionDays: number;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseEnergyEmoji(value: string | undefined): Record<string, string> {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("ENERGY_EMOJI must be a JSON object of energy type to emoji");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ENERGY_EMOJI must be a JSON object of energy type to emoji");
  }
  const entries = Object.entries(parsed);
  if (entries.some(([, emoji]) => typeof emoji !== "string")) {
    throw new Error("ENERGY_EMOJI must be a JSON object of energy type to emoji");
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const token = env.DISCORD_TOKEN?.trim();
  const clientId = env.DISCORD_CLIENT_ID?.trim();
  if (!token) throw new Error("DISCORD_TOKEN is required");
  if (!clientId) throw new Error("DISCORD_CLIENT_ID is required");

  return {
    token,
    clientId,
    ...(env.DISCORD_GUILD_ID?.trim() ? { guildId: env.DISCORD_GUILD_ID.trim() } : {}),
    mentionEnabled: parseBoolean(env.MENTION_ENABLED, true),
    decklistEnabled: parseBoolean(env.DECKLIST_ENABLED, false),
    mentionCooldownSeconds: parsePositiveInt(env.MENTION_COOLDOWN_SECONDS, 0),
    attribution: env.ATTRIBUTION?.trim() || DEFAULT_ATTRIBUTION,
    energyEmoji: parseEnergyEmoji(env.ENERGY_EMOJI),
    ...(env.INVOCATION_LOG_DIR?.trim() ? { invocationLogDir: env.INVOCATION_LOG_DIR.trim() } : {}),
    invocationLogRetentionDays: parsePositiveInt(env.INVOCATION_LOG_RETENTION_DAYS, 60),
  };
}
