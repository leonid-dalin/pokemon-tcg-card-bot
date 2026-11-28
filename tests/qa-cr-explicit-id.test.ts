import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Card, CardSummary } from "../src/api/types.js";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import { TcgdexError } from "../src/api/tcgdex.js";
import { handlePrintingsCommand } from "../src/discord/commands.js";
import { PageStore } from "../src/discord/pages.js";
import { getPocketCard } from "../src/api/pocket.js";
import { isPocketCardId } from "../src/prizes.js";
import { SettingsStore } from "../src/settings-store.js";

const controls = JSON.parse(
  readFileSync(new URL("./fixtures/qa-review-controls.json", import.meta.url), "utf8"),
) as { promo: Card; physical: Card };

const client = {
  searchByName: async () => [controls.physical, controls.promo] as CardSummary[],
  getCard: async (id: string) => {
    if (id === controls.physical.id) return controls.physical;
    if (id === controls.promo.id) return controls.promo;
    return getPocketCard(id) ?? (() => { throw new TcgdexError("injected missing", 404); })();
  },
} as unknown as TcgdexClient;

function store(defaultGame: "ptcg" | "pocket") {
  const settings = new SettingsStore(undefined, {
    messageReplies: true,
    decklistReplies: false,
    cooldownSeconds: 0,
  });
  settings.update("guild", { cardGames: "both", defaultCardGame: defaultGame });
  return settings;
}

async function printings(query: string, settings: SettingsStore) {
  const replies: Record<string, unknown>[] = [];
  await handlePrintingsCommand(
    { client, attribution: "TCGdex", energyEmoji: {}, pages: new PageStore(), settings } as never,
    {
      guildId: "guild",
      user: { id: "member" },
      options: { getString: () => query },
      deferReply: async () => {},
      editReply: async (payload) => {
        replies.push(payload as never);
      },
    } as never,
  );
  return replies[0];
}

const offeredValues = (reply: Record<string, unknown> | undefined) =>
  (reply?.components as { toJSON: () => { components: { options?: { value?: string }[] }[] } }[] | undefined)
    ?.flatMap((row) => row.toJSON().components)
    .flatMap((component) => component.options?.map((option) => option.value ?? "") ?? []) ?? [];

describe("explicit ID sets the /printings game scope", () => {
  it("lists Pocket printings for a Pocket ID under a physical default", async () => {
    const settings = store("ptcg");
    try {
      const reply = await printings("a1-036", settings);
      const values = offeredValues(reply);
      expect(values.length).toBeGreaterThan(0);
      expect(values.every((value) => isPocketCardId(value))).toBe(true);
      expect(values).not.toContain("sv03-125");
      for (const value of values) {
        const opened = await client.getCard(value);
        expect(opened.name).toBe("Charizard ex");
      }
    } finally {
      settings.close();
    }
  });

  it("keeps the bare physical name on the effective default", async () => {
    const settings = store("ptcg");
    try {
      const values = offeredValues(await printings("Charizard ex", settings));
      expect(values).toContain("sv03-125");
    } finally {
      settings.close();
    }
  });

  it("keeps the physical override direction", async () => {
    const settings = store("pocket");
    try {
      const values = offeredValues(await printings("sv03-125", settings));
      expect(values.length).toBeGreaterThan(0);
      expect(values.every((value) => !isPocketCardId(value))).toBe(true);
    } finally {
      settings.close();
    }
  });
});
