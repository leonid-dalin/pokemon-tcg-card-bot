import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Card, CardSummary } from "../src/api/types.js";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import { TcgdexError } from "../src/api/tcgdex.js";
import { handleAutocomplete } from "../src/discord/commands.js";
import { printingsOf } from "../src/printings.js";
import { getPocketCard } from "../src/api/pocket.js";
import { lookupById } from "../src/lookup.js";
import { SettingsStore } from "../src/settings-store.js";
import { pocketPrintingKey } from "../src/printed.js";

const promo = JSON.parse(
  readFileSync(new URL("./fixtures/qa-review-controls.json", import.meta.url), "utf8"),
) as { promo: Card };

const client = {
  searchByName: async () => [promo.promo] as CardSummary[],
  getCard: async (id: string) => {
    if (id === promo.promo.id) return promo.promo;
    return getPocketCard(id) ?? (() => { throw new TcgdexError("injected missing", 404); })();
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

async function autocomplete(query: string, settings: SettingsStore) {
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

describe("promo alias deduplication", () => {
  it("uses one canonical identity for printed and package promo spellings", () => {
    expect(pocketPrintingKey("P-A-007")).toBe(pocketPrintingKey("pa-007"));
    expect(pocketPrintingKey("P-A-007")).toBe(pocketPrintingKey("a7"));
    expect(pocketPrintingKey("P-B-007")).not.toBe(pocketPrintingKey("pa-007"));
    expect(pocketPrintingKey("P-A-016")).not.toBe(pocketPrintingKey("pa-007"));
  });

  it("offers two unique printings in the controlled promo case", async () => {
    const settings = store();
    try {
      const choices = await autocomplete("Professor's Research", settings);
      expect(choices).toHaveLength(2);
      expect(choices.map((choice) => choice.value)).toContain("a4b-373");
      expect(choices.filter((choice) => choice.value.toLowerCase().includes("pa"))).toHaveLength(1);
      for (const choice of choices) {
        const opened = await lookupById(client, choice.value);
        expect(opened?.card.name).toBe("Professor's Research");
      }
    } finally {
      settings.close();
    }
  });

  it("keeps one promo row in printing discovery", async () => {
    const rows = await printingsOf(client, "Professor's Research", "both");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id)).toContain("a4b-373");
    expect(rows.filter((row) => row.id.toLowerCase().includes("pa"))).toHaveLength(1);
  });
});
