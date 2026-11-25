import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import type { Card, CardSummary } from "../src/api/types.js";
import { handleAllPrintingsButton } from "../src/discord/commands.js";
import { PageStore } from "../src/discord/pages.js";
import { cardReply } from "../src/discord/replies.js";
import { isPocketCardId } from "../src/prizes.js";

const base = JSON.parse(readFileSync(new URL("./fixtures/selection-card-me03-030.json", import.meta.url), "utf8")) as Card;
const physicalSummaries: CardSummary[] = [
  { id: "me03-030", name: "Clefairy", localId: "030" },
  { id: "swsh11-062", name: "Clefairy", localId: "062" },
];
const client = {
  searchByName: async () => physicalSummaries,
  getCard: async (id: string) => ({ ...base, id, name: "Clefairy" }),
} as unknown as TcgdexClient;
const ids = (payload: { components?: unknown[] }) =>
  (payload.components ?? []).flatMap((row) => (row as { toJSON: () => { components: { custom_id?: string }[] } }).toJSON().components.map((component) => component.custom_id ?? ""));

async function listFor(customId: string, settings: { cardGames: string; defaultCardGame: string }) {
  const pages = new PageStore();
  let payload: { embeds?: { data?: { title?: string } }[]; components?: unknown[] } | undefined;
  await handleAllPrintingsButton({
    client, attribution: "TCGdex", energyEmoji: {}, pages,
    settings: { get: () => settings },
  } as never, {
    customId, guildId: "g1", user: { id: "owner" },
    deferReply: async () => {}, editReply: async (value) => { payload = value as never; },
  } as never);
  const token = ids(payload!).find((id) => id.startsWith("open:"))!.split(":")[1]!;
  return { page: pages.get(token)!, title: payload?.embeds?.[0]?.data?.title };
}

describe("R2 all-printings retains the selected game", () => {
  it("keeps a Pocket card on a physical-default server", async () => {
    const reply = cardReply({ card: { ...base, id: "b4-064", name: "Clefairy" }, alternates: [], matchingPrintings: [] }, "owner");
    const action = ids(reply).find((id) => id.startsWith("allprint:"))!;
    const { page } = await listFor(action, { cardGames: "both", defaultCardGame: "ptcg" });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((item) => isPocketCardId(item.cardId))).toBe(true);
  });

  it("keeps a physical card on a Pocket-default server", async () => {
    const reply = cardReply({ card: base, alternates: [], matchingPrintings: [] }, "owner");
    const action = ids(reply).find((id) => id.startsWith("allprint:"))!;
    const { page } = await listFor(action, { cardGames: "both", defaultCardGame: "pocket" });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.some((item) => !isPocketCardId(item.cardId))).toBe(true);
  });

  it("ignores a settings change between reply and press", async () => {
    const reply = cardReply({ card: { ...base, id: "b4-064", name: "Clefairy" }, alternates: [], matchingPrintings: [] }, "owner");
    const action = ids(reply).find((id) => id.startsWith("allprint:"))!;
    const { page } = await listFor(action, { cardGames: "ptcg", defaultCardGame: "ptcg" });
    expect(page.items.every((item) => isPocketCardId(item.cardId))).toBe(true);
  });
});
