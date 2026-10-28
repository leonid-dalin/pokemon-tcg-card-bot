import { describe, expect, it } from "vitest";
import { mentionReply, searchReply } from "../src/discord/replies.js";

describe("searchReply", () => {
  it("says so when no card wording matches", () => {
    expect(searchReply("zzz", [], "Card data from TCGdex")).toEqual({ content: "No card wording mentions `zzz`." });
  });

  it("lists the hits in one embed", () => {
    const reply = searchReply("iono", [{ id: "sv02-185", name: "Iono", text: "" }], "Card data from TCGdex");
    expect("embeds" in reply && reply.embeds).toHaveLength(1);
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
