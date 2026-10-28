import { describe, expect, it } from "vitest";
import { PageStore } from "../src/discord/pages.js";
import { mentionReply, searchReply } from "../src/discord/replies.js";

describe("searchReply", () => {
  it("says so when no card wording matches", () => {
    expect(searchReply("zzz", [], "Card data from TCGdex")).toEqual({ content: "No card wording mentions `zzz`." });
  });

  it("pages grouped hits with five items", () => {
    const groups = Array.from({ length: 11 }, (_, index) => ({
      representative: { id: `sv01-${String(index + 1).padStart(3, "0")}`, name: `Card ${index + 1}`, text: "draw 2 cards" },
      printings: 1,
    }));
    const reply = searchReply("draw 2 cards", groups, "Card data from TCGdex", "owner", new PageStore());
    expect("embeds" in reply && reply.embeds).toHaveLength(1);
    expect("components" in reply && reply.components).toHaveLength(2);
    expect("embeds" in reply && reply.embeds[0]?.data.title).toBe('11 cards mention "draw 2 cards"');
  });
});

describe("mentionReply", () => {
  it("lists every miss on its own line", () => {
    const reply = mentionReply([], [
      { raw: "Foo", closest: [] },
      { raw: "Bar ex", closest: [{ id: "sv01-001", name: "Bar" }] },
    ]);
    expect(reply.content).toBe("No card matched `Foo`.\nNo card matched `Bar ex`. Pick the closest below.");
  });

  it("offers the closest cards as a menu after a miss", () => {
    const reply = mentionReply([], [
      { raw: "Bar ex", closest: [{ id: "sv01-001", name: "Bar" }, { id: "sv01-002", name: "Bar ex" }] },
    ]);
    expect("components" in reply && reply.components).toHaveLength(1);
    const menu = reply.components![0]!.toJSON() as { components: { options: { label: string; value: string }[] }[] };
    expect(menu.components[0]?.options.map((option) => option.value)).toEqual(["sv01-001", "sv01-002"]);
    expect(menu.components[0]?.options[0]?.label).toBe("Bar · SVI 1");
  });

  it("gives a miss without suggestions no menu", () => {
    const reply = mentionReply([], [{ raw: "Foo", closest: [] }]);
    expect("components" in reply).toBe(false);
  });

  it("keeps four rows for one found card and two misses", () => {
    const reply = mentionReply(
      [{ card: { id: "sv01-001", name: "Bar" }, alternates: [{ id: "sv01-002", name: "Bar" }] }],
      [
        { raw: "Baz", closest: [{ id: "sv01-003", name: "Baz" }] },
        { raw: "Qux", closest: [{ id: "sv01-004", name: "Qux" }] },
      ],
    );
    expect("components" in reply && reply.components).toHaveLength(4);
  });
});
