import { describe, expect, it } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import { TcgdexError } from "../src/api/tcgdex.js";
import { handleCardCommand } from "../src/discord/commands.js";
import { createMessageHandler } from "../src/discord/messages.js";
import { PageStore } from "../src/discord/pages.js";
import { lookupCard } from "../src/lookup.js";
import { SettingsStore } from "../src/settings-store.js";

import { readFileSync } from "node:fs";
import type { Card } from "../src/api/types.js";

const physicalCard = JSON.parse(readFileSync(new URL("./fixtures/swsh12.5-019.json", import.meta.url), "utf8")) as Card;

const api = {
  searchByName: async () => [],
  getCard: async () => { throw new TcgdexError("injected missing", 404); },
} as unknown as TcgdexClient;

function store(defaultGame: "ptcg" | "pocket") {
  const settings = new SettingsStore(undefined, { messageReplies: true, decklistReplies: false, cooldownSeconds: 0 });
  settings.update("g1", { cardGames: "both", defaultCardGame: defaultGame });
  return settings;
}

async function slash(query: string, hint: string | undefined, settings: SettingsStore) {
  const replies: { content?: string; embeds?: { toJSON: () => { title?: string } }[]; components?: unknown[] }[] = [];
  await handleCardCommand({ client: api, attribution: "TCGdex", energyEmoji: {}, pages: new PageStore(), settings } as never, {
    guildId: "g1", user: { id: "member" },
    options: { getString: (name: string) => name === "name" ? query : name === "set" ? hint : null, getBoolean: () => null },
    deferReply: async () => {}, editReply: async (payload) => { replies.push(payload as never); },
  } as never);
  return replies[0];
}

async function inline(query: string, hint: string | undefined, settings: SettingsStore) {
  const replies: { content?: string; embeds?: { toJSON: () => { title?: string } }[]; components?: unknown[] }[] = [];
  await createMessageHandler({
    api, config: { mentionEnabled: true, decklistEnabled: false, mentionCooldownSeconds: 0, attribution: "TCGdex", energyEmoji: {} },
    pages: new PageStore(), settings, selfId: () => "bot",
  })({
    id: "m", guildId: "g1", channelId: "c", author: { id: "member", bot: false, username: "member" }, webhookId: null, system: false,
    content: `[[${query}${hint ? `|${hint}` : ""}]]`, attachments: { size: 0 }, embeds: [], stickers: { size: 0 },
    reply: async (payload) => { replies.push(payload as never); return { id: "r" }; },
  } as never);
  return replies[0];
}

const ids = (payload: { components?: unknown[] } | undefined) =>
  ((payload?.components ?? []) as { toJSON: () => { components: { custom_id?: string }[] } }[])
    .flatMap((row) => row.toJSON().components.map((component) => component.custom_id ?? ""))
    .map((id) => /^allprint:([^:]+)/.exec(id)?.[1])
    .filter((value): value is string => Boolean(value));

async function assertScopedNoMatch(query: string, hint: string | undefined) {
  const settings = store("pocket");
  const pref = { allowed: "both", default: "pocket" } as const;
  expect(await lookupCard(api, query, hint, { gamePreference: pref })).toBeUndefined();
  for (const reply of [await slash(query, hint, settings), await inline(query, hint, settings)]) {
    expect(reply?.content).toContain("No card matched");
    expect(ids(reply)).toEqual([]);
  }
  settings.close();
}

describe("N1 mechanics and owner prefixes survive package selection", () => {
  for (const query of ["Charizard VSTAR", "Pikachu VMAX", "Mewtwo VSTAR", "Cynthia's Garchomp ex"]) {
    it(`${query} gets a scoped no-match on Pocket default`, async () => {
      await assertScopedNoMatch(query, undefined);
    });
  }

  it("explicit pocket and A1 hints also reject Charizard VSTAR", async () => {
    await assertScopedNoMatch("Charizard VSTAR", "pocket");
    await assertScopedNoMatch("Charizard VSTAR", "A1");
  });

  it("Gengar-EX resolves to a compatible Gengar ex printing", async () => {
    const settings = store("pocket");
    const result = await lookupCard(api, "Gengar-EX", undefined, { gamePreference: { allowed: "both", default: "pocket" } });
    expect(result?.card.name).toBe("Gengar ex");
    expect(result?.card.id.toLowerCase()).toMatch(/^a/);
    for (const reply of [await slash("Gengar-EX", undefined, settings), await inline("Gengar-EX", undefined, settings)]) {
      expect(ids(reply)).toContain(result!.card.id);
    }
    settings.close();
  });

  it("keeps valid Charizard ex, partial Char and physical VSTAR controls", async () => {
    const settings = store("pocket");
    expect((await lookupCard(api, "Charizard ex"))?.card.name).toBe("Charizard ex");
    expect((await lookupCard(api, "Char"))?.card.name).toBeDefined();
    const physicalApi = {
      searchByName: async () => [{ id: "swsh12.5-019", name: "Charizard VSTAR", localId: "019" }],
      getCard: async (id: string) => ({ ...physicalCard, id }),
    } as unknown as TcgdexClient;
    const physical = await lookupCard(physicalApi, "Charizard VSTAR", undefined, { gamePreference: { allowed: "both", default: "ptcg" } });
    expect(physical?.card.id).toBe("swsh12.5-019");
    settings.close();
  });
});
