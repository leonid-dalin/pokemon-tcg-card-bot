import { describe, expect, it } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import { TcgdexError } from "../src/api/tcgdex.js";
import { handleAutocomplete, handleCardCommand } from "../src/discord/commands.js";
import { createMessageHandler } from "../src/discord/messages.js";
import { PageStore } from "../src/discord/pages.js";
import { lookupById, lookupCard } from "../src/lookup.js";
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

async function autocomplete(query: string, settings: SettingsStore, client: TcgdexClient = api) {
  const responses: { name: string; value: string }[][] = [];
  await handleAutocomplete(
    { client, settings } as never,
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

const noMatch = (reply: { content?: string } | undefined) => (reply?.content ?? "").includes("No card matched");

describe("P2 no-compatible and multiword partial contracts", () => {
  it("gives a scoped no-match when no printing preserves a modifier", async () => {
    const names = ["Radiant Charizard", "Dark Charizard", "Light Arcanine", "Shining Gyarados"];
    const settings = store();
    try {
      for (const name of names) {
        for (const hint of [undefined, "pocket"]) {
          expect(await lookupCard(api, name, hint, { gamePreference: preferences })).toBeUndefined();
          expect(noMatch(await slash(name, hint, settings))).toBe(true);
          expect(noMatch(await inline(name, hint, settings))).toBe(true);
        }
      }
    } finally {
      settings.close();
    }
  });

  it("keeps compatible variants while rejecting the shorter base cards", async () => {
    const settings = store();
    try {
      const cases: [string, string][] = [
        ["Ultra Necrozma", "Ultra Necrozma ex"],
        ["Hisuian Zoroark", "Hisuian Zoroark ex"],
      ];
      for (const [query, name] of cases) {
        for (const hint of [undefined, "pocket"]) {
          const found = await lookupCard(api, query, hint, { gamePreference: preferences });
          expect(found?.card.name).toBe(name);
        }
        for (const reply of [await slash(query, "pocket", settings), await inline(query, "pocket", settings)]) {
          expect(reply?.embeds?.[0]?.toJSON().title).toBe(name);
        }
      }
    } finally {
      settings.close();
    }
  });

  it("completes a typed partial to a card that matches what was typed", async () => {
    const settings = store();
    try {
      const cases: [string, string][] = [
        ["Charizard e", "Charizard ex"],
        ["Professor's R", "Professor's Research"],
      ];
      for (const [query, name] of cases) {
        const found = await lookupCard(api, query, "pocket", { gamePreference: preferences });
        expect(found?.card.name).toBe(name);
        for (const reply of [await slash(query, "pocket", settings), await inline(query, "pocket", settings)]) {
          expect(noMatch(reply)).toBe(false);
          expect(reply?.embeds?.[0]?.toJSON().title).toBe(name);
        }
      }
      expect((await lookupCard(api, "Char", "pocket", { gamePreference: preferences }))?.card.name).toContain("Char");
    } finally {
      settings.close();
    }
  });

  it("keeps multiword partial autocomplete and its selected card", async () => {
    const settings = store();
    try {
      for (const mode of ["empty", "rejected"] as const) {
        const client = {
          searchByName: async () => {
            if (mode === "rejected") throw new TcgdexError("injected unavailable", 503);
            return [];
          },
          getCard: async () => {
            throw new TcgdexError("injected missing", 404);
          },
        } as unknown as TcgdexClient;
        const offered = await autocomplete("Professor's R", settings, client);
        expect(offered.map((choice) => choice.value)).toContain("a4b-373");
        const opened = await lookupById(client, offered.find((choice) => choice.value === "a4b-373")!.value);
        expect(opened?.card.name).toBe("Professor's Research");
      }
    } finally {
      settings.close();
    }
  });
});
