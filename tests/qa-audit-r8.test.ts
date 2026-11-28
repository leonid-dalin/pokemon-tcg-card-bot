import { describe, expect, it } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import { lookupCard } from "../src/lookup.js";
import { handleCardCommand } from "../src/discord/commands.js";
import { PageStore } from "../src/discord/pages.js";

const client = {
  searchByName: async () => [],
  getCard: async () => { throw Object.assign(new Error("not found"), { status: 404 }); },
} as unknown as TcgdexClient;

async function slash(query: string, hint: string) {
  const replies: { content?: string; embeds?: { toJSON: () => { title?: string } }[] }[] = [];
  await handleCardCommand({ client, attribution: "TCGdex", energyEmoji: {}, pages: new PageStore() } as never, {
    guildId: null, user: { id: "member" },
    options: { getString: (name: string) => name === "name" ? query : name === "set" ? hint : null },
    deferReply: async () => {}, editReply: async (payload) => { replies.push(payload as never); },
  } as never);
  return replies[0];
}

describe("R8 explicit Pocket aliases keep short-name safety", () => {
  for (const alias of ["pocket", "tcgp", "ptcgp"]) {
    it(`${alias} gives no match for N, Q and Z`, async () => {
      for (const query of ["N", "Q", "Z"]) {
        expect(await lookupCard(client, query, alias)).toBeUndefined();
        const reply = await slash(query, alias);
        expect(reply?.content).toContain("No card matched");
      }
    });
  }

  it("keeps an existing exact short name in the physical game", async () => {
    const withIndex = {
      searchByName: async () => [],
      getCard: async (id: string) => ({ id, name: "N" }),
    } as unknown as TcgdexClient;
    const result = await lookupCard(withIndex, "N", undefined, { gamePreference: { allowed: "both", default: "ptcg" } });
    expect(result?.card.id.toLowerCase()).toBe("xy10-105a");
  });
});
