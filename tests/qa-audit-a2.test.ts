import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Card, TcgdexClient } from "../src/api/tcgdex.js";
import { handlePrintingsCommand } from "../src/discord/commands.js";
import { PageStore } from "../src/discord/pages.js";
import { printingsOf } from "../src/printings.js";
import { isPocketCardId } from "../src/prizes.js";

const card = JSON.parse(readFileSync(new URL("./fixtures/selection-card-me03-030.json", import.meta.url), "utf8")) as Card;
const empty: TcgdexClient = {
  searchByName: async () => [],
  getCard: async () => card,
} as unknown as TcgdexClient;

async function publicList(name: string) {
  const replies: { components?: unknown[] }[] = [];
  const pages = new PageStore();
  await handlePrintingsCommand({
    client: empty, attribution: "TCGdex", energyEmoji: {}, pages,
    settings: { get: () => ({ cardGames: "ptcg", defaultCardGame: "ptcg" }) },
  } as never, {
    guildId: "g1", user: { id: "member" },
    options: { getString: () => name },
    deferReply: async () => {}, editReply: async (payload) => { replies.push(payload as never); },
  } as never);
  const ids = ((replies[0]?.components ?? []) as { toJSON: () => { components: { custom_id?: string }[] } }[])
    .flatMap((row) => row.toJSON().components.map((component) => component.custom_id ?? ""));
  const token = ids.map((id) => /^open:([^:]+)$/.exec(id)?.[1]).find((value) => value !== undefined)!;
  const page = pages.get(token)!;
  return { items: page.items.map((item) => item.cardId), title: page.title };
}

describe("A2 physical printing discovery stays physical on empty upstream", () => {
  it("excludes Pocket rows from the helper fallback", async () => {
    const rows = await printingsOf(empty, "Mythical Slab", "ptcg");
    expect(rows.some((row) => isPocketCardId(row.id))).toBe(false);
  });

  it("excludes Pocket rows from Clefairy's helper fallback", async () => {
    const rows = await printingsOf(empty, "Clefairy", "ptcg");
    expect(rows.some((row) => isPocketCardId(row.id))).toBe(false);
  });

  it("shows only physical cards in the public printings list", async () => {
    const { items, title } = await publicList("Clefairy");
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((id) => !isPocketCardId(id))).toBe(true);
    expect(items.some((id) => id.toLowerCase() === "swsh11-062")).toBe(true);
    expect(title).toContain("Clefairy");
  });
});
