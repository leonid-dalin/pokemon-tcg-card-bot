import { describe, expect, it } from "vitest";
import type { GuildSettings } from "../src/settings-store.js";
import { renderPanel, type PanelModel } from "../src/discord/settings-panel.js";

const channels = Array.from({ length: 50 }, (_, i) => `ch-${i}`);
const server = {
  messageReplies: true, decklistReplies: false, autoReplyChannelMode: "selected" as const,
  selectedChannelIds: channels, cooldownSeconds: 0, cardGames: "both" as const, defaultCardGame: "ptcg" as const,
} as GuildSettings;

function model(page?: number): PanelModel {
  return {
    session: {
      id: "s1", guildId: "g1", userId: "owner", scope: "server", screen: "channels",
      baseline: "b", createdAt: 0, draftChannelIds: channels,
      ...(page === undefined ? {} : { draftRemovePage: page }),
    },
    server, mentionEnabled: true, isAdmin: true, heading: "Channels", rows: [],
  } as PanelModel;
}

const values = (payload: unknown): string[] => {
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const node = value as { custom_id?: string; options?: { value: string }[]; components?: unknown[] };
    if (node.custom_id) found.push(node.custom_id);
    for (const option of node.options ?? []) found.push(option.value);
    for (const child of node.components ?? []) walk(child);
  };
  walk(payload);
  return found;
};

describe("P3 channel remove menu pagination", () => {
  it("offers the first 25 entries and a next-page control", () => {
    const found = values(renderPanel(model()).toJSON() as never);
    expect(found).toContain("ch-24");
    expect(found).not.toContain("ch-25");
    expect(found.some((value) => value.startsWith("st:ch:remove-page:"))).toBe(true);
  });

  it("reaches later entries on the second page", () => {
    const found = values(renderPanel(model(1)).toJSON() as never);
    expect(found).toContain("ch-25");
    expect(found).toContain("ch-49");
    expect(found).not.toContain("ch-0");
  });
});
