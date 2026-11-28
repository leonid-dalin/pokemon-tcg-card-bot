import { describe, expect, it } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import { TcgdexError } from "../src/api/tcgdex.js";
import { handleCardCommand } from "../src/discord/commands.js";
import { createMessageHandler } from "../src/discord/messages.js";
import { PageStore } from "../src/discord/pages.js";
import { lookupCard } from "../src/lookup.js";
import { SettingsStore } from "../src/settings-store.js";

const api = {
  searchByName: async () => [],
  getCard: async () => {
    throw new TcgdexError("injected missing", 404);
  },
} as unknown as TcgdexClient;

const preferences = { allowed: "both", default: "pocket" } as const;

function store() {
  const settings = new SettingsStore(undefined, {
    messageReplies: true,
    decklistReplies: false,
    cooldownSeconds: 0,
  });
  settings.update("guild", { cardGames: "both", defaultCardGame: "pocket" });
  return settings;
}

async function slash(query: string, hint: string, settings: SettingsStore) {
  const replies: { embeds?: { toJSON: () => { title?: string } }[] }[] = [];
  await handleCardCommand(
    { client: api, attribution: "TCGdex", energyEmoji: {}, pages: new PageStore(), settings } as never,
    {
      guildId: "guild", user: { id: "member" },
      options: {
        getString: (key: string) => (key === "name" ? query : key === "set" ? hint : null),
        getBoolean: () => null,
      },
      deferReply: async () => {},
      editReply: async (payload) => { replies.push(payload as never); },
    } as never,
  );
  return replies[0];
}

async function inline(query: string, hint: string, settings: SettingsStore) {
  const replies: { embeds?: { toJSON: () => { title?: string } }[] }[] = [];
  await createMessageHandler({
    api,
    config: { mentionEnabled: true, decklistEnabled: false, mentionCooldownSeconds: 0, attribution: "TCGdex", energyEmoji: {} },
    pages: new PageStore(), settings, selfId: () => "bot",
  })({
    id: "message", guildId: "guild", channelId: "channel",
    author: { id: "member", bot: false, username: "member" }, webhookId: null, system: false,
    content: `[[${query}|${hint}]]`, attachments: { size: 0 }, embeds: [], stickers: { size: 0 },
    reply: async (payload) => { replies.push(payload as never); return { id: "reply" }; },
  } as never);
  return replies[0];
}

describe("F5 mechanic alias with a concrete set", () => {
  it("opens the same compatible card for both Gengar spellings", async () => {
    const settings = store();
    try {
      for (const spelling of ["Gengar ex", "Gengar-EX"]) {
        const found = await lookupCard(api, spelling, "b2b", { gamePreference: preferences });
        expect(found?.card.id).toBe("b2b-039");
        expect(found?.card.name).toBe("Mega Gengar ex");
        for (const reply of [await slash(spelling, "b2b", settings), await inline(spelling, "b2b", settings)]) {
          expect(reply?.embeds?.[0]?.toJSON().title).toBe("Mega Gengar ex");
        }
      }
    } finally {
      settings.close();
    }
  });

  it("keeps the Charizard concrete-set controls", async () => {
    for (const spelling of ["Charizard", "Chariz", "Charizard ex"]) {
      const found = await lookupCard(api, spelling, "A2b", { gamePreference: preferences });
      expect(found?.card.id).toBe("a2b-010");
    }
  });

  it("keeps scoped no-match and Mew/Mewtwo separation", async () => {
    expect(await lookupCard(api, "Charizard", "A2", { gamePreference: preferences })).toBeUndefined();
    expect((await lookupCard(api, "Mew", "pocket", { gamePreference: preferences }))?.card.name).toBe("Mew");
  });
});
