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

async function slash(query: string, hint: string | undefined, settings: SettingsStore) {
  const replies: { embeds?: { toJSON: () => { title?: string } }[]; content?: string }[] = [];
  await handleCardCommand(
    { client: api, attribution: "TCGdex", energyEmoji: {}, pages: new PageStore(), settings } as never,
    {
      guildId: "guild",
      user: { id: "member" },
      options: {
        getString: (key: string) => (key === "name" ? query : key === "set" ? hint : null),
        getBoolean: () => null,
      },
      deferReply: async () => {},
      editReply: async (payload) => {
        replies.push(payload as never);
      },
    } as never,
  );
  return replies[0];
}

async function inline(query: string, hint: string | undefined, settings: SettingsStore) {
  const replies: { embeds?: { toJSON: () => { title?: string } }[]; content?: string }[] = [];
  await createMessageHandler({
    api,
    config: {
      mentionEnabled: true,
      decklistEnabled: false,
      mentionCooldownSeconds: 0,
      attribution: "TCGdex",
      energyEmoji: {},
    },
    pages: new PageStore(),
    settings,
    selfId: () => "bot",
  })({
    id: "message",
    guildId: "guild",
    channelId: "channel",
    author: { id: "member", bot: false, username: "member" },
    webhookId: null,
    system: false,
    content: `[[${query}${hint ? `|${hint}` : ""}]]`,
    attachments: { size: 0 },
    embeds: [],
    stickers: { size: 0 },
    reply: async (payload) => {
      replies.push(payload as never);
      return { id: "reply" };
    },
  } as never);
  return replies[0];
}

const title = (reply: { embeds?: { toJSON: () => { title?: string } }[] } | undefined) =>
  reply?.embeds?.[0]?.toJSON().title;

describe("F5 concrete set hint keeps compatible printings", () => {
  it("opens Charizard ex in A2b from the full base name", async () => {
    const settings = store();
    try {
      const found = await lookupCard(api, "Charizard", "A2b", { gamePreference: preferences });
      expect(found?.card.id).toBe("a2b-010");
      expect(found?.card.name).toBe("Charizard ex");
      for (const reply of [await slash("Charizard", "A2b", settings), await inline("Charizard", "A2b", settings)]) {
        expect(title(reply)).toBe("Charizard ex");
      }
    } finally {
      settings.close();
    }
  });

  it("keeps the partial and explicit-mechanic controls in A2b", async () => {
    for (const query of ["Chariz", "Charizard ex"]) {
      const found = await lookupCard(api, query, "A2b", { gamePreference: preferences });
      expect(found?.card.id).toBe("a2b-010");
      expect(found?.card.name).toBe("Charizard ex");
    }
  });

  it("keeps a missing set as a scoped no-match", async () => {
    const settings = store();
    try {
      expect(await lookupCard(api, "Charizard", "A2", { gamePreference: preferences })).toBeUndefined();
      for (const reply of [await slash("Charizard", "A2", settings), await inline("Charizard", "A2", settings)]) {
        expect(reply?.content ?? "").toContain("No card matched");
      }
    } finally {
      settings.close();
    }
  });

  it("does not turn Mew into Mewtwo", async () => {
    const found = await lookupCard(api, "Mew", "pocket", { gamePreference: preferences });
    expect(found?.card.name).toBe("Mew");
    expect(found?.card.name).not.toBe("Mewtwo");
  });
});
