import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Card, TcgdexClient } from "../src/api/tcgdex.js";
import { handleCardCommand } from "../src/discord/commands.js";
import { PageStore } from "../src/discord/pages.js";
import { isCardId, lookupCard } from "../src/lookup.js";

const offered = JSON.parse(readFileSync(new URL("./fixtures/me06-011.json", import.meta.url), "utf8")) as Card;

function client(): TcgdexClient {
  return {
    searchByName: async () => [],
    getCard: async (id: string) => (id === "me06-011" ? offered : undefined as never),
  } as unknown as TcgdexClient;
}

async function slash() {
  const replies: { content?: string; embeds?: { toJSON: () => { title?: string } }[]; components?: unknown[] }[] = [];
  await handleCardCommand({ client: client(), attribution: "TCGdex", energyEmoji: {}, pages: new PageStore() } as never, {
    guildId: null, user: { id: "member" },
    options: { getString: (name: string) => name === "name" ? "me06-011" : null },
    deferReply: async () => {}, editReply: async (payload) => { replies.push(payload as never); },
  } as never);
  return replies[0];
}

describe("A1 autocomplete offered ids resolve", () => {
  it("recognises the offered id from its numbered physical set", () => {
    expect(isCardId("me06-011")).toBe(true);
  });

  it("opens the exact offered id through the helper", async () => {
    expect((await lookupCard(client(), "me06-011"))?.card.id).toBe("me06-011");
  });

  it("opens the exact offered id through slash /card", async () => {
    const reply = await slash();
    expect(reply?.embeds?.[0]?.toJSON().title).toBe("Mega Golisopod ex");
    expect(reply?.content).toBeUndefined();
  });
});
