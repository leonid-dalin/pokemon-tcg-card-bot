import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import type { Card } from "../src/api/types.js";
import { handleCardCommand } from "../src/discord/commands.js";
import { createMessageHandler } from "../src/discord/messages.js";
import { PageStore } from "../src/discord/pages.js";
import { lookupCard } from "../src/lookup.js";

const dragapult = JSON.parse(readFileSync(new URL("./fixtures/dragapult-ex-sv08.5-073.json", import.meta.url), "utf8")) as Card;

function client(): TcgdexClient {
  return {
    searchByName: async () => [],
    getCard: async (id: string) => {
      if (!id.toLowerCase().startsWith("sv08.5-")) throw Object.assign(new Error("not found"), { status: 404 });
      return { ...dragapult, id, name: "Dragapult ex" };
    },
  } as unknown as TcgdexClient;
}

const titles = (payload: { embeds?: { data?: { title?: string } }[] }) => payload.embeds?.map((embed) => embed.data?.title) ?? [];
const ids = (payload: { components?: unknown[] }) =>
  (payload.components ?? []).flatMap((row) => (row as { toJSON: () => { components: { custom_id?: string }[] } }).toJSON().components.map((component) => component.custom_id ?? ""));

describe("R3 raw card IDs address the same card in every public entry point", () => {
  it("resolves a raw ID in the lookup helper", async () => {
    expect((await lookupCard(client(), "sv08.5-073"))?.card.id).toBe("sv08.5-073");
  });

  it("resolves a raw ID in the inline handler", async () => {
    const replies: { content?: string; embeds?: { data?: { title?: string } }[] }[] = [];
    const handler = createMessageHandler({
      api: client(),
      config: { mentionEnabled: true, decklistEnabled: false, mentionCooldownSeconds: 0, attribution: "TCGdex", energyEmoji: {} },
      pages: new PageStore(), selfId: () => "bot",
    });
    await handler({
      id: "i", author: { id: "member", bot: false, username: "member" }, webhookId: null, system: false,
      content: "[[sv08.5-073]]", attachments: { size: 0 }, embeds: [], stickers: { size: 0 },
      channelId: "c", guildId: null, member: undefined, channel: {},
      reply: async (payload) => { replies.push(payload as never); return {}; },
    } as never);
    expect(titles(replies[0]!)).toContain("Dragapult ex");
  });

  it("resolves a raw ID in the slash handler", async () => {
    const replies: { content?: string; embeds?: { data?: { title?: string } }[]; components?: unknown[] }[] = [];
    await handleCardCommand({
      client: client(), attribution: "TCGdex", energyEmoji: {}, pages: new PageStore(),
    } as never, {
      guildId: null, user: { id: "member" },
      options: { getString: (name: string) => name === "name" ? "sv08.5-073" : null },
      deferReply: async () => {}, editReply: async (payload) => { replies.push(payload as never); },
    } as never);
    expect(titles(replies[0]!)).toContain("Dragapult ex");
  });

  it("routes a raw Pocket ID through both handlers", async () => {
    const replies: { embeds?: { data?: { title?: string } }[] }[] = [];
    const handler = createMessageHandler({
      api: client(),
      config: { mentionEnabled: true, decklistEnabled: false, mentionCooldownSeconds: 0, attribution: "TCGdex", energyEmoji: {} },
      pages: new PageStore(), selfId: () => "bot",
    });
    await handler({
      id: "i", author: { id: "member", bot: false, username: "member" }, webhookId: null, system: false,
      content: "[[a1-036]]", attachments: { size: 0 }, embeds: [], stickers: { size: 0 },
      channelId: "c", guildId: null, member: undefined, channel: {},
      reply: async (payload) => { replies.push(payload as never); return {}; },
    } as never);
    expect(titles(replies[0]!)).toContain("Charizard ex");
    const slash: typeof replies = [];
    await handleCardCommand({ client: client(), attribution: "TCGdex", energyEmoji: {}, pages: new PageStore() } as never, {
      guildId: null, user: { id: "member" },
      options: { getString: (name: string) => name === "name" ? "a1-036" : null },
      deferReply: async () => {}, editReply: async (payload) => { slash.push(payload as never); },
    } as never);
    expect(titles(slash[0]!)).toContain("Charizard ex");
    expect(ids(slash[0]!).some((id) => id.startsWith("allprint:"))).toBe(true);
  });
});
