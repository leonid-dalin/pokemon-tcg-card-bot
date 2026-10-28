import { describe, expect, it } from "vitest";
import type { CardSummary } from "../src/api/types.js";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import { PageStore } from "../src/discord/pages.js";
import { commandDefinitions, handlePrintingsCommand } from "../src/discord/commands.js";
import { printingsOf, printingHeading } from "../src/printings.js";
import { getPocketCard } from "../src/api/pocket.js";
import { SET_INDEX } from "../src/data/set-index.js";

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
    // The physical printing follows the newer Pocket records onto the second page.
    expect(description).toContain("A4B 59 · Deluxe Pack: ex 2025");
    expect(titleOf(replies[0])).toBe("11 printings of Charizard ex");
    const pages = replies[0]?.components as { toJSON: () => { components: { custom_id?: string; label?: string } } }[];
    expect(pages.some((row) => row.toJSON().components.some((component) => component.custom_id?.startsWith("page:") && component.label === "▶"))).toBe(true);
  });
});

const offline = { searchByName: async () => [] } as unknown as TcgdexClient;

function releaseDate(id: string): string | undefined {
  return getPocketCard(id)?.set?.releaseDate ?? SET_INDEX.find((entry) => entry.id === id.split("-")[0])?.releaseDate;
}

describe("printingsOf chronology and identity", () => {
  it("orders Pocket-only printings by their real release dates", async () => {
    const dated = (await printingsOf(offline, "Charizard ex")).map((printing) => ({
      id: printing.id,
      date: releaseDate(printing.id),
    }));
    expect(dated.length).toBeGreaterThan(2);
    for (const row of dated) expect(row.date, row.id).toBeTruthy();
    for (let i = 1; i < dated.length; i += 1) {
      expect(dated[i - 1]!.date! >= dated[i]!.date!, dated.map((row) => row.id).join(",")).toBe(true);
    }
  });

  it("keeps one row for the same Pocket printing cased differently", async () => {
    const client = { searchByName: async () => [{ id: "A1-036", name: "Charizard ex" }] } as unknown as TcgdexClient;
    const printings = await printingsOf(client, "Charizard ex");
    expect(printings.filter((printing) => printing.id.toLowerCase() === "a1-036")).toHaveLength(1);
  });

  it("sorts a mixed physical and Pocket list on one timeline", async () => {
    const client = {
      searchByName: async () => [
        { id: "swsh4.5-8", name: "Crustle" },
        { id: "bw5-8", name: "Crustle" },
      ],
    } as unknown as TcgdexClient;
    const printings = await printingsOf(client, "Crustle");
    const dates = printings.map((printing) => ({ id: printing.id, date: releaseDate(printing.id) }));
    expect(dates.length).toBeGreaterThan(2);
    for (let i = 1; i < dates.length; i += 1) {
      expect(dates[i - 1]!.date! >= dates[i]!.date!).toBe(true);
    }
  });

  it("prints a heading with the printed code and the set", () => {
    expect(printingHeading({ id: "bw5-8", name: "Crustle", setLabel: "Dark Explorers 2012" })).toBe("DEX 8 · Dark Explorers 2012");
  });
});
