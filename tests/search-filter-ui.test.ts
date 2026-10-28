import { describe, expect, it } from "vitest";
import { listReply, filterFrom, pageFilterFrom, pageIndexFrom, type ListPage } from "../src/discord/pages.js";

const items = (categories: (string | undefined)[]) =>
  categories.map((category, index) => ({
    cardId: `sv01-${String(index + 1).padStart(3, "0")}`,
    heading: `Card ${index + 1}`,
    ...(category ? { category } : {}),
  }));

const page = (categories: (string | undefined)[], extra: Partial<ListPage> = {}): ListPage => ({
  title: "Cards",
  items: items(categories),
  perPage: 5,
  ownerId: "owner",
  footer: "Source",
  filterable: true,
  ...extra,
});

const rowJson = (reply: ReturnType<typeof listReply>, index: number) =>
  reply.components[index]!.toJSON() as { components: { custom_id?: string; label?: string; options?: { label: string; value: string }[]; placeholder?: string }[] };

const options = (reply: ReturnType<typeof listReply>) => {
  const menu = reply.components.find((row) => rowJson({ components: [row] } as never, 0).components[0]?.placeholder === "Show only");
  return menu ? rowJson({ components: [menu] } as never, 0).components[0]!.options ?? [] : [];
};

describe("filter row", () => {
  it("offers only categories that hold at least one card", () => {
    const reply = listReply(page(["Pokemon", "Trainer", "Pokemon"]), "tok", 0);
    expect(options(reply).map((o) => o.value)).toEqual(["all", "Pokemon", "Trainer"]);
  });

  it("shows the count beside each choice", () => {
    const reply = listReply(page(["Pokemon", "Trainer", "Pokemon"]), "tok", 0);
    expect(options(reply).map((o) => o.label)).toEqual(["All cards (3)", "Pokémon (2)", "Trainers (1)"]);
  });

  it("omits the row when only one category exists", () => {
    const reply = listReply(page(["Pokemon", "Pokemon", "Pokemon"]), "tok", 0);
    expect(options(reply)).toEqual([]);
  });

  it("omits the row for a list that cannot be filtered", () => {
    const reply = listReply(page([undefined, undefined], { filterable: false }), "tok", 0);
    expect(options(reply)).toEqual([]);
  });

  it("narrows the list to the chosen category", () => {
    const reply = listReply(page(["Pokemon", "Trainer", "Pokemon"]), "tok", 0, "Trainer");
    const description = reply.embeds[0]?.data.description ?? "";
    expect(description).toContain("Card 2");
    expect(description).not.toContain("Card 1");
  });

  it("counts the pages of the narrowed list", () => {
    const many = Array.from({ length: 12 }, (_, i) => (i < 6 ? "Trainer" : "Pokemon"));
    const reply = listReply(page(many), "tok", 0, "Trainer");
    expect(rowJson(reply, 0).components[1]?.label).toBe("1 / 2");
  });

  it("carries the filter on the page buttons", () => {
    const many = Array.from({ length: 12 }, (_, i) => (i < 6 ? "Trainer" : "Pokemon"));
    const reply = listReply(page(many), "tok", 1, "Trainer");
    expect(pageFilterFrom(rowJson(reply, 0).components[2]?.custom_id ?? "")).toBe("Trainer");
    expect(pageIndexFrom(rowJson(reply, 0).components[2]?.custom_id ?? "")).toBe(2);
  });
});

describe("custom ids", () => {
  it("reads a filter id", () => {
    expect(filterFrom("filter:abcdefgh")).toBe("abcdefgh");
    expect(filterFrom("filter:")).toBeUndefined();
    expect(filterFrom("open:abcdefgh")).toBeUndefined();
  });

  it("reads a page id that still has no filter, for messages already sent", () => {
    expect(pageIndexFrom("page:abcdefgh:2")).toBe(2);
    expect(pageFilterFrom("page:abcdefgh:2")).toBeUndefined();
  });
});
