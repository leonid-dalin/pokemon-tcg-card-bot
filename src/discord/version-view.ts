import { EmbedBuilder } from "discord.js";
import { buildIdentity, formatUptime } from "../version.js";
import { ratesDate } from "../currency.js";

const SOURCE_LABEL = { env: "deployed", build: "bundle", git: "checkout", package: "package version" } as const;

/** The revision, package version, build date, uptime and rate-snapshot age. */
export function versionLines(startedAt = Date.now() - process.uptime() * 1_000, now = Date.now()): string[] {
  const identity = buildIdentity();
  return [
    `Revision: ${identity.label} (${SOURCE_LABEL[identity.source]})`,
    identity.packageVersion ? `Version: ${identity.packageVersion}` : undefined,
    identity.built ? `Last updated: ${identity.built.slice(0, 10)}` : undefined,
    `Uptime: ${formatUptime(now - startedAt)}`,
    ratesDate() ? `Exchange rates: ${ratesDate()}` : undefined,
  ].filter((line): line is string => Boolean(line));
}

/** The version reply as an embed, matching the card embeds around it. */
export function versionEmbed(startedAt = Date.now() - process.uptime() * 1_000, now = Date.now()): EmbedBuilder {
  return new EmbedBuilder().setDescription(versionLines(startedAt, now).join("\n"));
}
