import { describe, expect, it } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import { TcgdexError } from "../src/api/tcgdex.js";
import { handleAutocomplete, handleCardCommand } from "../src/discord/commands.js";
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

function store() {
  const settings = new SettingsStore(undefined, {
    messageReplies: true,
    decklistReplies: false,
    cooldownSeconds: 0,
  });
  settings.update("guild", { cardGames: "both", defaultCardGame: "pocket" });
  return settings;
}

const preferences = { allowed: "both", default: "pocket" } as const;

async function slash(query: string, settings: SettingsStore) {
  const replies: { embeds?: { toJSON: () => { title?: string } }[]; content?: string }[] = [];
  await handleCardCommand(
    {
      client: api,
      attribution: "TCGdex",
      energyEmoji: {},
      pages: new PageStore(),
      settings,
    } as never,
    {
      guildId: "guild",
      user: { id: "member" },
      options: {
        getString: (key: string) => (key === "name" ? query : key === "set" ? "pocket" : null),
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

async function inline(query: string, settings: SettingsStore) {
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
    content: `[[${query}|pocket]]`,
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

async function autocomplete(query: string, settings: SettingsStore) {
  const responses: { name: string; value: string }[][] = [];
  await handleAutocomplete(
    { client: api, settings } as never,
    {
      guildId: "guild",
      user: { id: "member" },
      options: { getFocused: () => ({ name: "name", value: query }) },
      respond: async (choices) => {
        responses.push(choices as never);
      },
    } as never,
  );
  return responses[0] ?? [];
}

describe("re-audit matching contracts", () => {
  it("keeps every requested name component when a compatible printing exists", async () => {
    const cases: [string, string][] = [
      ["Ultra Necrozma", "pa081"],
      ["Hisuian Zoroark", "b3b060"],
    ];
    for (const [query, expected] of cases) {
      const found = await lookupCard(api, query, "pocket", {
        gamePreference: preferences,
        energyEmoji: {},
      });
      expect(found?.card.id.toLowerCase().replace(/[^a-z0-9]/g, "")).toBe(expected);
      expect(found?.card.name).toContain(query);
    }
  });

  it("delivers the compatible printing through both public handlers", async () => {
    const settings = store();
    try {
      for (const reply of [await slash("Ultra Necrozma", settings), await inline("Ultra Necrozma", settings)]) {
        expect(reply?.embeds?.[0]?.toJSON().title).toBe("Ultra Necrozma ex");
      }
    } finally {
      settings.close();
    }
  });

  it("keeps supported partial queries available", async () => {
    const settings = store();
    try {
      const expected: [string, string][] = [
        ["prime", "a1-142"],
        ["Professor's", "a4b-373"],
      ];
      for (const [query, id] of expected) {
        const found = await lookupCard(api, query, "pocket", {
          gamePreference: preferences,
          energyEmoji: {},
        });
        expect(found?.card.id).toBe(id);
        for (const reply of [await slash(query, settings), await inline(query, settings)]) {
          expect(reply?.content ?? "").not.toContain("No card matched");
          expect(reply?.embeds?.[0]?.toJSON().title).toBeTruthy();
        }
        const offered = await autocomplete(query, settings);
        expect(offered.map((choice) => choice.value)).toContain(id);
      }
    } finally {
      settings.close();
    }
  });

  it("offers mechanic-spelled autocomplete choices that open the same card", async () => {
    const settings = store();
    try {
      const spaced = await autocomplete("Gengar ex", settings);
      const attached = await autocomplete("Gengar-EX", settings);
      expect(spaced.length).toBeGreaterThan(0);
      expect(attached.map((choice) => choice.value)).toEqual(spaced.map((choice) => choice.value));
      const opened = await lookupCard(api, attached[0]!.value, undefined, {
        gamePreference: preferences,
        energyEmoji: {},
      });
      expect(opened?.card.name).toBe("Gengar ex");
    } finally {
      settings.close();
    }
  });
});
