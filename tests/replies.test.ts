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
    expect(reply).toEqual({ content: "No card matched `Foo`.\nNo card matched `Bar ex`. Closest: `Bar` (SVI 1)." });
  });
});
