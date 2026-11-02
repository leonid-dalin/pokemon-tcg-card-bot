import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import type { Card } from "../src/api/types.js";
import { createMessageHandler, type IncomingMessage } from "../src/discord/messages.js";
import { PageStore } from "../src/discord/pages.js";
import { splitTrailingSet } from "../src/lookup.js";

describe("splitTrailingSet", () => {
  it.each([
    ["kingdra swsh10", { name: "kingdra", setHint: "swsh10" }],
    ["kingdra ASR", { name: "kingdra", setHint: "ASR" }],
    ["charizard sv03.5", { name: "charizard", setHint: "sv03.5" }],
  ])("reads %s as a name and a set", (query, expected) => {
    expect(splitTrailingSet(query)).toEqual(expected);
  });

  it.each([["kingdra"], ["pikachu ex"], ["kingdra notaset"], ["ASR"]])("leaves %s alone", (query) => {
    expect(splitTrailingSet(query)).toBeUndefined();
  });

  it("never splits a real multi-word card name", () => {
    const index = JSON.parse(readFileSync(new URL("../src/data/text-index.json", import.meta.url), "utf8")) as { name: string }[];
    const names = [...new Set(index.map((entry) => entry.name))].filter((name) => name.trim().includes(" "));
    expect(names.length).toBeGreaterThan(1000);
    expect(names.filter((name) => splitTrailingSet(name))).toEqual([]);
  });
});

describe("a mention with a trailing set code", () => {
  it("finds the card in that set instead of answering with a miss", async () => {
    const dragapult = JSON.parse(readFileSync(new URL("./fixtures/dragapult-ex-sv08.5-073.json", import.meta.url), "utf8")) as Card;
    const summaries = [
      { id: "sv08.5-073", name: "Dragapult ex", localId: "073" },
      { id: "sv06-130", name: "Dragapult ex", localId: "130" },
    ];
    const api = {
      searchByName: async (name: string) => summaries.filter((card) => card.name.toLowerCase().includes(name.toLowerCase())),
      getCard: async (id: string) => ({ ...dragapult, id }),
    } as unknown as TcgdexClient;
    const replies: Record<string, unknown>[] = [];
    const message = {
      author: { bot: false, id: "1", username: "tester" },
      webhookId: null,
      system: false,
      content: "[[Dragapult ex sv08.5]]",
      attachments: { size: 0 },
      embeds: [],
      stickers: { size: 0 },
      channelId: "c",
      reply: async (payload: Record<string, unknown>) => void replies.push(payload),
    } as unknown as IncomingMessage;
    await createMessageHandler({
      api,
      config: { mentionEnabled: true, decklistEnabled: false, mentionCooldownSeconds: 0, attribution: "Card data from TCGdex", energyEmoji: {} },
      pages: new PageStore(),
      selfId: () => "999",
    })(message);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.content).toBeUndefined();
    const embeds = replies[0]?.embeds as { data: { footer?: { text: string } } }[];
    expect(embeds[0]?.data.footer?.text).toContain("PRE");
  });
});
