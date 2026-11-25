import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Card, TcgdexClient } from "../src/api/tcgdex.js";
import { createMessageHandler } from "../src/discord/messages.js";
import { PageStore } from "../src/discord/pages.js";
import { SettingsStore } from "../src/settings-store.js";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "qa-a8-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function card(): Card {
  return JSON.parse(readFileSync(new URL("./fixtures/selection-card-me03-030.json", import.meta.url), "utf8")) as Card;
}

const client = {
  searchByName: async () => [{ id: "me03-030", name: "Clefairy", localId: "030" }],
  getCard: async () => card(),
} as unknown as TcgdexClient;

const deckText = ["Pokemon: 60", ...Array.from({ length: 15 }, () => "4 Clefairy ME03 30"), "Total Cards: 60"].join("\n");

async function replyPrice(guildId: string, userId: string, store: SettingsStore) {
  const replies: { fields?: { name?: string; value?: string }[]; embeds?: { toJSON: () => { fields?: { name?: string; value?: string }[] } }[] }[] = [];
  await createMessageHandler({
    api: client,
    config: { mentionEnabled: true, decklistEnabled: true, mentionCooldownSeconds: 0, attribution: "TCGdex", energyEmoji: {} },
    pages: new PageStore(), settings: store, selfId: () => "bot",
  })({
    id: "deck", guildId, channelId: "c1", author: { id: userId, bot: false, username: "member" }, webhookId: null, system: false,
    content: deckText, attachments: { size: 0 }, embeds: [], stickers: { size: 0 },
    reply: async (payload) => { replies.push(payload as never); return { id: "r" }; },
  } as never);
  const fields = replies[0]?.fields ?? replies[0]?.embeds?.[0]?.toJSON().fields ?? [];
  const value = fields.find((field) => field.name === "Deck price")?.value ?? null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

describe("A8 deck prices follow persisted currency preferences", () => {
  it("uses the guild GBP preference", async () => {
    const store = new SettingsStore(join(scratch, "a8-guild.db"), { messageReplies: true, decklistReplies: true, cooldownSeconds: 0 });
    store.update("g1", { decklistReplies: true, currency: "GBP" });
    expect(await replyPrice("g1", "owner", store)).toMatch(/£/);
    store.close();
  });

  it("uses the personal USD preference over the guild", async () => {
    const store = new SettingsStore(join(scratch, "a8-user.db"), { messageReplies: true, decklistReplies: true, cooldownSeconds: 0 });
    store.update("g1", { decklistReplies: true, currency: "GBP" });
    store.setCurrency("owner", "USD");
    expect(await replyPrice("g1", "owner", store)).toMatch(/\$/);
    store.close();
  });
});
