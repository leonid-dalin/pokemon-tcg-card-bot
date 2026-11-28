import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Card, CardSummary } from "../src/api/types.js";
import { handleCardCommand } from "../src/discord/commands.js";
import { createMessageHandler } from "../src/discord/messages.js";
import { PageStore } from "../src/discord/pages.js";
import { lookupCard } from "../src/lookup.js";
import { isPocketCardId } from "../src/prizes.js";

const base = JSON.parse(readFileSync(new URL("./fixtures/dragapult-ex-sv08.5-073.json", import.meta.url), "utf8")) as Card;
const pref = { allowed: "both", default: "pocket" } as const;

function client() {
  const summaries: CardSummary[] = [
    { id: "xy10-105a", name: "N", localId: "105a" },
    { id: "bw3-101", name: "N", localId: "101" },
  ];
  return {
    searchByName: async () => summaries,
    getCard: async (id: string) => ({ ...base, id, name: "N" }),
  } as never;
}

function settings() {
  return {
    get: () => ({ cardGames: "both", defaultCardGame: "pocket", messageReplies: true, decklistReplies: false, autoReplyChannelMode: "all" as const, selectedChannelIds: [], cooldownSeconds: 0 }),
  };
}

async function publicIds(hint: string) {
  const replies: { components?: unknown[]; embeds?: { toJSON: () => { footer?: { text?: string } } }[] }[] = [];
  const store = settings();
  const handler = createMessageHandler({
    api: client(), config: { mentionEnabled: true, decklistEnabled: false, mentionCooldownSeconds: 0, attribution: "TCGdex", energyEmoji: {} },
    pages: new PageStore(), settings: store, selfId: () => "bot", cleanup: { schedule: () => {}, cancel: () => {} },
  });
  await handler({
    id: "i", guildId: "g1", channelId: "c1", author: { id: "owner", bot: false, username: "owner" }, webhookId: null, system: false,
    content: `[[N|${hint}]]`, attachments: { size: 0 }, embeds: [], stickers: { size: 0 },
    reply: async (payload) => { replies.push(payload as never); return { id: "r1" }; },
  } as never);
  const slash: typeof replies = [];
  await handleCardCommand({ client: client(), attribution: "TCGdex", energyEmoji: {}, pages: new PageStore(), settings: store } as never, {
    guildId: "g1", user: { id: "owner" },
    options: { getString: (name: string) => name === "name" ? "N" : name === "set" ? hint : null },
    deferReply: async () => {}, editReply: async (payload) => { slash.push(payload as never); },
  } as never);
  const ids = (payload: (typeof replies)[number] | undefined) =>
    (payload?.components as { toJSON: () => { components: { custom_id?: string }[] } }[] ?? [])
      .flatMap((row) => row.toJSON().components.map((component) => component.custom_id ?? ""))
      .map((id) => /^allprint:([^:]+)/.exec(id)?.[1])
      .filter((value): value is string => Boolean(value));
  return {
    mention: ids(replies[0]!),
    slash: ids(slash[0]!),
    footer: replies[0]?.embeds?.[0]?.toJSON().footer?.text ?? null,
    content: replies[0]?.content ?? null,
  };
}

describe("R7 short-name set constraint", () => {
  it("keeps the FCO printing", async () => {
    const result = await lookupCard(client(), "N", "FCO", { gamePreference: pref });
    expect(result?.card.id).toBe("xy10-105a");
    const publicResult = await publicIds("FCO");
    expect(publicResult.mention).toContain("xy10-105a");
    expect(publicResult.slash).toContain("xy10-105a");
    expect(publicResult.footer).toContain("FCO 105a");
  });

  it("returns the NVI printing instead of FCO", async () => {
    const result = await lookupCard(client(), "N", "NVI", { gamePreference: pref });
    expect(result?.card.id).toBe("bw3-101");
    const publicResult = await publicIds("NVI");
    expect(publicResult.mention).toContain("bw3-101");
    expect(publicResult.slash).toContain("bw3-101");
    expect(publicResult.footer).not.toContain("FCO 105a");
  });

  it("returns no match for a Pocket set without N", async () => {
    const result = await lookupCard(client(), "N", "A1", { gamePreference: pref });
    expect(result).toBeUndefined();
    const publicResult = await publicIds("A1");
    expect(publicResult.mention).toEqual([]);
    expect(publicResult.slash).toEqual([]);
  });

  it("returns no match for a physical set without N", async () => {
    const result = await lookupCard(client(), "N", "sv03.5", { gamePreference: pref });
    expect(result).toBeUndefined();
    const publicResult = await publicIds("sv03.5");
    expect(publicResult.mention).toEqual([]);
    expect(publicResult.slash).toEqual([]);
  });

  it("keeps the unhinted Pocket-default negative control", async () => {
    expect(await lookupCard(client(), "N", undefined, { gamePreference: pref })).toBeUndefined();
  });

  it("keeps Charizard ex A1 on a physical default", async () => {
    const result = await lookupCard(client(), "Charizard ex", "A1", { gamePreference: { allowed: "both", default: "ptcg" } });
    expect(isPocketCardId(result!.card.id)).toBe(true);
  });
});
