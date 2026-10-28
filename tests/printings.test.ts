import { describe, expect, it } from "vitest";
import type { CardSummary } from "../src/api/types.js";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import { PageStore } from "../src/discord/pages.js";
import { commandDefinitions, handlePrintingsCommand } from "../src/discord/commands.js";

const context = (client: TcgdexClient, pages = new PageStore()) => ({
  client,
  attribution: "Card data from TCGdex",
  energyEmoji: {},
  pages,
});

/** A client that answers a name search with the printings it was given. */
function fakeClient(printings: CardSummary[]): TcgdexClient {
  return {
    searchByName: async (name: string) =>
      printings.filter((card) => card.name.toLowerCase().includes(name.toLowerCase())),
  } as unknown as TcgdexClient;
}

function interaction(name: string) {
  const replies: Record<string, unknown>[] = [];
  return {
    interaction: {
      options: { getString: () => name },
      user: { id: "owner" },
      deferReply: async () => {},
      editReply: async (payload: Record<string, unknown>) => {
        replies.push(payload);
        return {};
      },
    },
    replies,
  };
}

const descriptionOf = (reply: Record<string, unknown> | undefined): string =>
  (reply?.embeds as { data: { description?: string } }[] | undefined)?.[0]?.data.description ?? "";

const titleOf = (reply: Record<string, unknown> | undefined): string | undefined =>
  (reply?.embeds as { data: { title?: string } }[] | undefined)?.[0]?.data.title;

describe("handlePrintingsCommand", () => {
  it("is registered with the other commands", () => {
    expect(commandDefinitions.map((command) => command.name)).toContain("printings");
  });

  it("lists every printing newest first", async () => {
    const client = fakeClient([
      { id: "sv06-130", name: "Dragapult ex" },
      { id: "sv08.5-073", name: "Dragapult ex" },
      { id: "sv08-200", name: "Dragapult ex" },
    ]);
    const { interaction: press, replies } = interaction("Dragapult ex");
    await handlePrintingsCommand(context(client), press as never);
    const description = descriptionOf(replies[0]);
    const order = ["PRE 73", "SSP 200", "TWM 130"].map((printed) => description.indexOf(printed));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("leaves out a printing whose name differs", async () => {
    const client = fakeClient([
      { id: "sv06-130", name: "Dragapult ex" },
      { id: "sv08.5-073", name: "Dragapult ex" },
      { id: "sv08-079", name: "Dragapult" },
    ]);
    const { interaction: press, replies } = interaction("Dragapult ex");
    await handlePrintingsCommand(context(client), press as never);
    const description = descriptionOf(replies[0]);
    expect(description).toContain("TWM 130");
    expect(description).toContain("PRE 73");
    expect(description).not.toMatch(/Dragapult\b(?! ex)/);
    expect(titleOf(replies[0])).toBe("2 printings of Dragapult ex");
  });

  it("pages twelve printings over two pages", async () => {
    const printings = Array.from({ length: 12 }, (_, index) => ({
      id: `sv01-${String(index + 1).padStart(3, "0")}`,
      name: "Iono",
    }));
    const { interaction: press, replies } = interaction("Iono");
    await handlePrintingsCommand(context(fakeClient(printings)), press as never);
    expect(descriptionOf(replies[0])?.split("\n").filter(Boolean)).toHaveLength(10);
    expect(replies[0]?.components).toHaveLength(2);
    const label = (replies[0]?.components as { toJSON: () => { components: { label: string }[] } }[])[0]!
      .toJSON()
      .components[1];
    expect(label?.label).toBe("1 / 2");
  });

  it("says so when nothing matches", async () => {
    const { interaction: press, replies } = interaction("Zzznotacard");
    await handlePrintingsCommand(context(fakeClient([])), press as never);
    expect(replies[0]).toEqual({ content: "No card matched `Zzznotacard`." });
  });

  it("labels a Pocket printing from the Pocket data", async () => {
    const client = fakeClient([{ id: "sv06-130", name: "Charizard ex" }]);
    const { interaction: press, replies } = interaction("Charizard ex");
    await handlePrintingsCommand(context(client), press as never);
    const description = descriptionOf(replies[0]);
    expect(description).toContain("TWM 130 · Twilight Masquerade 2024");
    expect(description).toContain("Deluxe Pack: ex 2025");
    expect(titleOf(replies[0])).toBe("11 printings of Charizard ex");
  });
});
