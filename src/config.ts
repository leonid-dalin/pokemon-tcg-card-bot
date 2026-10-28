import { DEFAULT_ATTRIBUTION } from "./render.js";

export interface Config {
  token: string;
  clientId: string;
  guildId?: string;
  mentionEnabled: boolean;
  /** Decklist parsing stays off until it can say something the list itself does not. */
  decklistEnabled: boolean;
  /** 0 disables the throttle entirely. */
  mentionCooldownSeconds: number;
  attribution: string;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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
  };
}
