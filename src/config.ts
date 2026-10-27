export interface Config {
  token: string;
  clientId: string;
  guildId?: string;
  mentionEnabled: boolean;
  mentionCooldownMs: number;
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
    mentionCooldownMs: parsePositiveInt(env.MENTION_COOLDOWN_SECONDS, 30) * 1000,
    attribution: env.ATTRIBUTION?.trim() || "Card data from TCGdex",
  };
}
