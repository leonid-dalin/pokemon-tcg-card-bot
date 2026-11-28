import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import type { Card, CardSummary } from "../src/api/types.js";
import { handleOpenCardMenu } from "../src/discord/commands.js";
import { createMessageHandler } from "../src/discord/messages.js";
import { PageStore } from "../src/discord/pages.js";
import { suggestNames } from "../src/lookup.js";
import { isPocketCardId } from "../src/prizes.js";
import { SettingsStore } from "../src/settings-store.js";

const physical = readFileSync(new URL("./fixtures/selection-card-me03-030.json", import.meta.url), "utf8") as unknown as Card;
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "qa-r1-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function client(): TcgdexClient {
  const summaries: CardSummary[] = [
    { id: "A1a-065", name: "Mythical Slab", localId: "065" },
    { id: "swsh12-109", name: "Mythical Slab", localId: "109" },
  ];
  return {
    searchByName: async () => summaries,
    getCard: async (id: string) => ({ ...physical, id, name: "Mythical Slab" }),
  } as unknown as TcgdexClient;
}

const physicalDefault = { allowed: "both", default: "ptcg" } as const;

describe("R1 miss suggestions stay inside the effective game", () => {
  it("excludes Pocket from physical-default suggestions", async () => {
    const names = await suggestNames(client(), "Mythical Slab zzzz", 5, { gamePreference: physicalDefault });
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((card) => !isPocketCardId(card.id))).toBe(true);
  });

  it("keeps Pocket on a Pocket-default server", async () => {
    const names = await suggestNames(client(), "Mythical Slab zzzz", 5, { gamePreference: { allowed: "both", default: "pocket" } });
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((card) => isPocketCardId(card.id))).toBe(true);
  });

  it("never opens a Pocket card after a physical-default miss", async () => {
    const store = new SettingsStore(join(scratch, "r1.db"), { messageReplies: true, decklistReplies: false, cooldownSeconds: 0 });
    store.update("g1", { cardGames: "both", defaultCardGame: "ptcg" });
    const replies: { content?: string; components?: unknown[] }[] = [];
    const handler = createMessageHandler({
      api: client(),
      config: { mentionEnabled: true, decklistEnabled: false, mentionCooldownSeconds: 0, attribution: "TCGdex", energyEmoji: {} },
      pages: new PageStore(),
      settings: store,
      selfId: () => "bot",
      cleanup: { schedule: () => {}, cancel: () => {} },
    });
    await handler({
      id: "invoke", guildId: "g1", channelId: "c1", author: { id: "owner", bot: false, username: "owner" },
      webhookId: null, system: false, content: "[[Mythical Slab zzzz]]", attachments: { size: 0 }, embeds: [], stickers: { size: 0 },
      reply: async (payload) => { replies.push(payload as never); return { id: "reply-1" }; },
    } as never);
    const menu = (replies[0]!.components ?? []).flatMap((row) => (row as { toJSON: () => { components: { options?: { value: string }[]; custom_id?: string }[] } }).toJSON().components).find((component) => component.options?.length);
    expect(menu?.options?.length).toBeGreaterThan(0);
    const values = menu!.options!.map((option) => option.value);
    const picked = values.find((value) => isPocketCardId(value)) ?? values[0]!;
    expect(values.some((value) => isPocketCardId(value))).toBe(false);

    let opened: { embeds?: { data?: { title?: string } }[] } | undefined;
    await handleOpenCardMenu({
      client: client(), attribution: "TCGdex", energyEmoji: {}, pages: new PageStore(),
      settings: store, cleanup: { schedule: () => {}, cancel: () => {} },
    } as never, {
      customId: menu!.custom_id, values: [picked], guildId: "g1", channelId: "c1",
      message: { id: "reply-1" }, user: { id: "owner" },
      deferUpdate: async () => {}, editReply: async (payload) => { opened = payload as never; }, followUp: async () => {},
    } as never);
    expect(isPocketCardId(picked)).toBe(false);
    expect(opened?.embeds?.[0]?.data?.title).toBe("Mythical Slab");
    store.close();
  });
});
