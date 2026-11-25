import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import type { Card, CardSummary } from "../src/api/types.js";
import { handleAutocomplete } from "../src/discord/commands.js";
import { POCKET_ATTRIBUTION, lookupCard } from "../src/lookup.js";
import { extractMentions } from "../src/mentions.js";
import { isPocketCardId } from "../src/prizes.js";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const clefairyUpstream = fixture("clefairy-upstream.json") as CardSummary[];
const exeggcuteUpstream = fixture("exeggcute-upstream.json") as CardSummary[];
const lor = fixture("selection-card-swsh11-062.json") as Card;
const por = fixture("selection-card-me03-030.json") as Card;

function client(summaries: CardSummary[], cards: Card[] = []): TcgdexClient {
  const byId = new Map([...cards, ...summaries.map((entry) => ({ ...por, id: entry.id, name: entry.name }))].map((card) => [card.id, card]));
  return {
    searchByName: async () => summaries,
    getCard: async (id: string) => byId.get(id) ?? { ...por, id },
  } as unknown as TcgdexClient;
}

const physicalDefault = { allowed: "both", default: "ptcg" } as const;

describe("effective-game selection contract", () => {
  it("resolves the literal trailing code clefairy lor to the LOR printing", async () => {
    const mention = extractMentions("[[clefairy lor]]")[0]!;
    const result = await lookupCard(client(clefairyUpstream, [lor]), mention.name, mention.setHint, {
      gamePreference: physicalDefault,
    });
    expect(result?.card.id).toBe("swsh11-062");
  });

  it("resolves clefairy|lor to the same printing", async () => {
    const mention = extractMentions("[[clefairy|lor]]")[0]!;
    const result = await lookupCard(client(clefairyUpstream, [lor]), mention.name, mention.setHint, {
      gamePreference: physicalDefault,
    });
    expect(result?.card.id).toBe("swsh11-062");
  });

  it("does not send Exeggcute BW to Pocket on a physical-default server", async () => {
    const mention = extractMentions("[[Exeggcute BW]]")[0]!;
    const result = await lookupCard(client(exeggcuteUpstream), mention.name, mention.setHint, {
      gamePreference: physicalDefault,
    });
    expect(result === undefined || !isPocketCardId(result.card.id)).toBe(true);
    expect(result?.attribution).not.toBe(POCKET_ATTRIBUTION);
  });

  it("does not turn a physical miss into a Pocket result", async () => {
    const onlyPocket = [{ id: "A2b-010", name: "Pikachu", localId: "010" }] as CardSummary[];
    const result = await lookupCard(client(onlyPocket), "Pikachu", undefined, { gamePreference: physicalDefault });
    expect(result).toBeUndefined();
  });

  it("offers no Pocket ids in physical-default autocomplete", async () => {
    const responses: { name: string; value: string }[][] = [];
    const context = {
      client: client(clefairyUpstream, [lor, por]),
      attribution: "x",
      energyEmoji: {},
      settings: { get: () => ({ cardGames: "both", defaultCardGame: "ptcg" }) },
    };
    await handleAutocomplete(context as never, {
      guildId: "guild-a",
      user: { id: "member-1" },
      options: { getFocused: () => ({ name: "name", value: "Clefairy" }) },
      respond: async (value: { name: string; value: string }[]) => void responses.push(value),
    } as never);
    expect(responses[0]!.length).toBeGreaterThan(0);
    expect(responses[0]!.some((choice) => isPocketCardId(choice.value))).toBe(false);
    expect(responses[0]!.some((choice) => choice.value === "swsh11-062")).toBe(true);
  });
});
