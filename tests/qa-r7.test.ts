import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Card } from "../src/api/types.js";
import { handleCardCommand } from "../src/discord/commands.js";
import { createMessageHandler } from "../src/discord/messages.js";
import { PageStore } from "../src/discord/pages.js";
import { lookupCard } from "../src/lookup.js";
import { isPocketCardId } from "../src/prizes.js";

const dragapult = JSON.parse(readFileSync(new URL("./fixtures/dragapult-ex-sv08.5-073.json", import.meta.url), "utf8")) as Card;
const pocketCharizard = { ...dragapult, id: "a1-036", name: "Charizard ex" };
const n = { ...dragapult, id: "xy10-105a", name: "N" };

function client() {
  return {
    searchByName: async (query: string) => (query.toLowerCase() === "charizard ex" ? [{ id: "me02.5-014", name: "Charizard ex", localId: "014" }] : []),
    getCard: async (id: string) => ({ ...dragapult, id, name: id.toLowerCase().startsWith("a1-") ? "Charizard ex" : "N" }),
  } as never;
}

function settings(defaultGame: "ptcg" | "pocket") {
  return {
    get: () => ({ cardGames: "both", defaultCardGame: defaultGame, messageReplies: true, decklistReplies: false, autoReplyChannelMode: "all" as const, selectedChannelIds: [], cooldownSeconds: 0 }),
  };
}

async function publicLookup(query: string, hint: string, defaultGame: "ptcg" | "pocket") {
  const store = settings(defaultGame);
  const messageReplies: { content?: string; embeds?: { toJSON: () => { title?: string } }[] }[] = [];
  const handler = createMessageHandler({
    api: client(), config: { mentionEnabled: true, decklistEnabled: false, mentionCooldownSeconds: 0, attribution: "TCGdex", energyEmoji: {} },
    pages: new PageStore(), settings: store, selfId: () => "bot", cleanup: { schedule: () => {}, cancel: () => {} },
  });
  await handler({
    id: "i", guildId: "g1", channelId: "c1", author: { id: "owner", bot: false, username: "owner" }, webhookId: null, system: false,
    content: `[[${query}|${hint}]]`, attachments: { size: 0 }, embeds: [], stickers: { size: 0 },
    reply: async (payload) => { messageReplies.push(payload as never); return { id: "r1" }; },
  } as never);
  const slashReplies: { content?: string; embeds?: { toJSON: () => { title?: string } }[] }[] = [];
  await handleCardCommand({ client: client(), attribution: "TCGdex", energyEmoji: {}, pages: new PageStore(), settings: store } as never, {
    guildId: "g1", user: { id: "owner" },
    options: { getString: (name: string) => name === "name" ? query : name === "set" ? hint : null },
    deferReply: async () => {}, editReply: async (payload) => { slashReplies.push(payload as never); },
  } as never);
  return {
    mention: messageReplies[0]?.embeds?.[0]?.toJSON().title ?? messageReplies[0]?.content,
    slash: slashReplies[0]?.embeds?.[0]?.toJSON().title ?? slashReplies[0]?.content,
  };
}

describe("R7 explicit set overrides", () => {
  it("resolves a Pocket set on a both-games physical-default server", async () => {
    const helper = await lookupCard(client(), "Charizard ex", "A1", { gamePreference: { allowed: "both", default: "ptcg" } });
    expect(helper?.card.id.toLowerCase()).toBe("a1-036");
    const result = await publicLookup("Charizard ex", "A1", "ptcg");
    expect(result.mention).toBe("Charizard ex");
    expect(result.slash).toBe("Charizard ex");
  });

  it("resolves a physical set for a short name on a Pocket-default server", async () => {
    const helper = await lookupCard(client(), "N", "FCO", { gamePreference: { allowed: "both", default: "pocket" } });
    expect(helper?.card.id).toBe("xy10-105a");
    const result = await publicLookup("N", "FCO", "pocket");
    expect(result.mention).toBe("N");
    expect(result.slash).toBe("N");
  });

  it("keeps the Pocket set override on a physical-only server", async () => {
    const result = await lookupCard(client(), "Charizard ex", "A1", { gamePreference: { allowed: "ptcg", default: "ptcg" } });
    expect(isPocketCardId(result!.card.id)).toBe(true);
  });

  it("keeps unhinted physical-only names out of a Pocket default", async () => {
    const result = await lookupCard(client(), "Erika's Jigglypuff", undefined, { gamePreference: { allowed: "both", default: "pocket" } });
    expect(result === undefined || isPocketCardId(result.card.id)).toBe(true);
  });

  it("keeps the unhinted short-name Pocket default negative control", async () => {
    const result = await lookupCard(client(), "N", undefined, { gamePreference: { allowed: "both", default: "pocket" } });
    expect(result === undefined || isPocketCardId(result.card.id)).toBe(true);
  });

  it("uses the real package for the Pocket set override", () => {
    expect(isPocketCardId(pocketCharizard.id)).toBe(true);
    expect(isPocketCardId(n.id)).toBe(false);
  });
});
