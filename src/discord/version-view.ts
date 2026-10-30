import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { buildIdentity, formatUptime } from "../version.js";
import { ratesDate } from "../currency.js";

const SOURCE_LABEL = { env: "deployed", build: "bundle", git: "checkout", package: "package version" } as const;
const REPOSITORY = "https://github.com/leonid-dalin/pokemon-tcg-card-bot";
const HEX = /^[0-9a-f]{7,40}$/i;

/** The revision is only linked when the identity supplies a real hexadecimal revision. */
function revisionLink(label: string): string | undefined {
  return HEX.test(label) ? `${REPOSITORY}/commit/${label}` : undefined;
}

export interface VersionView {
  rows: { label: string; value: string }[];
  details: string[];
}

/** The shared version view for the slash reply, the mention card and its details. */
export function versionView(startedAt = Date.now() - process.uptime() * 1_000, now = Date.now()): VersionView {
  const identity = buildIdentity();
  const revision = identity.label;
  const short = HEX.test(revision) ? revision.slice(0, 8) : revision;
  const link = revisionLink(revision);
  const rows = [
    { label: "Running revision", value: link ? `[${short}](${link})` : short },
    { label: "App version", value: identity.packageVersion ?? "unavailable" },
    { label: "Built", value: identity.built ? identity.built.slice(0, 10) : "unavailable" },
    { label: "Uptime", value: formatUptime(now - startedAt) },
    { label: "Exchange-rate data", value: ratesDate() ?? "unavailable" },
  ];
  const details = [
    `Revision: ${revision} (${SOURCE_LABEL[identity.source]})`,
    identity.source === "package" ? "The revision is unavailable; this build reports its package version only." : undefined,
    identity.built ? `Built: ${identity.built}` : "Built: unavailable",
    `Identity source: ${SOURCE_LABEL[identity.source]}`,
    `App version: ${identity.packageVersion ?? "unavailable"}`,
    ratesDate() ? `Exchange-rate snapshot: ${ratesDate()}` : "Exchange-rate snapshot: unavailable",
  ].filter((line): line is string => Boolean(line));
  return { rows, details };
}

/** The same information as plain text, for the mention card. */
export function versionLines(startedAt = Date.now() - process.uptime() * 1_000, now = Date.now()): string[] {
  return versionView(startedAt, now).rows.map((row) => `${row.label}: ${row.value}`);
}

/** The version card, with Refresh, Details and Source actions. */
export function versionEmbed(startedAt = Date.now() - process.uptime() * 1_000, now = Date.now()): EmbedBuilder {
  const view = versionView(startedAt, now);
  const embed = new EmbedBuilder().setTitle("Crustlebot · Version");
  for (const row of view.rows) embed.addFields({ name: row.label, value: row.value, inline: true });
  return embed;
}

export function versionActions(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("v:refresh").setLabel("Refresh").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("v:details").setLabel("Details").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("v:source").setLabel("Source").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

/** The private details view, opened by the Details action. */
export function versionDetailsEmbed(startedAt = Date.now() - process.uptime() * 1_000, now = Date.now()): EmbedBuilder {
  const view = versionView(startedAt, now);
  return new EmbedBuilder().setTitle("Crustlebot · Version details").setDescription(view.details.join("\n"));
}
