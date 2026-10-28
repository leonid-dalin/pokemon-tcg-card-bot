import { describe, expect, it } from "vitest";
import type { CardSetRef } from "../src/api/types.js";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import { PageStore } from "../src/discord/pages.js";
import { handleSetCommand } from "../src/discord/commands.js";

/** The set shape TCGdex returns for `/v2/en/sets/me04`: 122 card stubs. */
function fakeSet(count: number): CardSetRef & { cards: { id: string; localId: string; name: string; image?: string }[] } {
  return {
    id: "me04",
    name: "Chaos Rising",
    cardCount: { official: count, total: count },
    releaseDate: "2026-05-22",
    serie: { id: "me", name: "Mega Evolution" },
    cards: Array.from({ length: count }, (_, index) => ({
      id: `me04-${String(index + 1).padStart(3, "0")}`,
      localId: String(index + 1).padStart(3, "0"),
      name: index === 0 ? "Weedle" : `Card ${index + 1}`,
      image: `https://assets.tcgdex.net/en/me/me04/${index + 1}`,
    })),
  };
}

function clientFor(set: CardSetRef): TcgdexClient {
  return { getSet: async () => set } as unknown as TcgdexClient;
}

function interaction(options: { id?: string; checklist?: boolean }) {
  const replies: Record<string, unknown>[] = [];
  return {
    interaction: {
      options: {
        getString: () => options.id ?? "me04",
        getBoolean: () => options.checklist ?? null,
      },
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

const embed = (reply: Record<string, unknown> | undefined) =>
  (reply?.embeds as { data: { title?: string; description?: string; fields?: { name: string }[] } }[] | undefined)?.[0]?.data;

const context = (set: CardSetRef) => ({
  client: clientFor(set),
  attribution: "Card data from TCGdex",
  energyEmoji: {},
  pages: new PageStore(),
});

describe("handleSetCommand checklist", () => {
  it("pages thirty-one cards over three pages", async () => {
    const { interaction: press, replies } = interaction({ checklist: true });
    await handleSetCommand(context(fakeSet(31)), press as never);
    const rows = embed(replies[0])?.description?.split("\n").filter(Boolean) ?? [];
    expect(rows).toHaveLength(15);
    expect(replies[0]?.components).toHaveLength(2);
    const buttons = (replies[0]?.components as { toJSON: () => { components: { label: string }[] } }[])[0]!.toJSON().components;
    expect(buttons[1]?.label).toBe("1 / 3");
  });

  it("heads each row with the number without leading zeros", async () => {
    const { interaction: press, replies } = interaction({ checklist: true });
    await handleSetCommand(context(fakeSet(31)), press as never);
    expect(embed(replies[0])?.description?.split("\n")[0]).toBe("1 Weedle");
  });

  it("puts the last card alone on the third page", async () => {
    const pages = new PageStore();
    const { interaction: press, replies } = interaction({ checklist: true });
    await handleSetCommand({ ...context(fakeSet(31)), pages }, press as never);
    const components = replies[0]?.components as { toJSON: () => { components: { custom_id: string }[] } }[];
    const token = components[0]!.toJSON().components[0]!.custom_id.split(":")[1]!;
    const page = pages.get(token);
    expect(page).toBeDefined();
    expect(page!.items.length).toBe(31);
    expect(page!.perPage).toBe(15);
  });

  it("keeps the set embed when the checklist is off", async () => {
    const { interaction: press, replies } = interaction({ checklist: false });
    await handleSetCommand(context(fakeSet(31)), press as never);
    const view = embed(replies[0]);
    expect(view?.description).toBeUndefined();
    expect(view?.title).toBe("Chaos Rising");
    expect(view?.fields?.map((field) => field.name)).toEqual(["Cards", "Series", "Released"]);
  });
});
