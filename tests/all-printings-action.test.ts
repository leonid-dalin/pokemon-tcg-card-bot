import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import type { Card, CardSummary } from "../src/api/types.js";
import { handleAllPrintingsButton } from "../src/discord/commands.js";
import { PageStore } from "../src/discord/pages.js";
import { cardReply } from "../src/discord/replies.js";
import { isPocketCardId } from "../src/prizes.js";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const upstream = fixture("clefairy-upstream.json") as CardSummary[];
const lor = fixture("selection-card-swsh11-062.json") as Card;
const por = fixture("selection-card-me03-030.json") as Card;

function client(): TcgdexClient {
  const cards = new Map<string, Card>([[lor.id, lor], [por.id, por]]);
  return {
    searchByName: async () => upstream,
    getCard: async (id: string) => cards.get(id) ?? { ...por, id },
  } as unknown as TcgdexClient;
}

function context(pages = new PageStore()) {
  return {
    client: client(),
    attribution: "Card data from TCGdex",
    energyEmoji: {},
    pages,
    settings: { get: () => ({ cardGames: "both", defaultCardGame: "ptcg" }) },
  };
}

function componentIds(payload: { components?: unknown[] }): string[] {
  return (payload.components ?? []).flatMap((row) => {
    const json = (row as { toJSON: () => { components: { custom_id?: string }[] } }).toJSON();
    return json.components.map((component) => component.custom_id ?? "");
  });
}

describe("all-printings action", () => {
  it("adds an owner-scoped action to a normal card reply", () => {
    const payload = cardReply({ card: por, alternates: [], matchingPrintings: [] }, "owner");
    expect(componentIds(payload)).toContain("allprint:me03-030:owner");
  });

  it("omits the action from image-only replies", () => {
    const payload = cardReply({ card: por, alternates: [], imageOnly: true }, "owner");
    expect(payload.components).toBeUndefined();
  });

  it("builds the full physical printing list and stores LOR exactly once", async () => {
    const pages = new PageStore();
    const edit = vi.fn(async () => ({}));
    await handleAllPrintingsButton(context(pages) as never, {
      customId: "allprint:me03-030:owner",
      guildId: "guild-a",
      user: { id: "owner" },
      deferReply: async () => {},
      editReply: edit as never,
    } as never);
    const payload = edit.mock.calls[0]![0] as { embeds: { data: { title?: string } }[]; components: unknown[] };
    expect(payload.embeds[0]!.data.title).toContain("printings of Clefairy");
    const token = componentIds(payload)
      .map((id) => /^page:([^:]+):\d+/.exec(id)?.[1])
      .find((value) => value !== undefined)!;
    const page = pages.get(token)!;
    expect(page.items.filter((item) => item.cardId === "swsh11-062")).toHaveLength(1);
    expect(page.items.some((item) => isPocketCardId(item.cardId))).toBe(false);
    expect(page.items.length).toBeGreaterThan(10);
  });

  it("refuses a press from a non-owner", async () => {
    const reply = vi.fn(async () => ({}));
    await handleAllPrintingsButton(context() as never, {
      customId: "allprint:me03-030:owner",
      user: { id: "someone-else" },
      reply: reply as never,
      deferReply: async () => {},
    } as never);
    expect(reply.mock.calls[0]![0]).toMatchObject({ flags: expect.anything() });
  });

  it("keeps different-wording LOR out of quick swaps", () => {
    const payload = cardReply({ card: por, alternates: [{ id: lor.id, name: lor.name }], matchingPrintings: [] }, "owner");
    expect(componentIds(payload)).not.toContain("printing:swsh11-062:owner");
  });
});
