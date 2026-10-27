import { describe, expect, it } from "vitest";
import { extractMentions } from "../src/mentions.js";

describe("extractMentions", () => {
  it("finds a bracketed card name", () => {
    expect(extractMentions("is [[Dragapult ex]] still the best deck?")).toEqual([
      { raw: "Dragapult ex", name: "Dragapult ex" },
    ]);
  });

  it("reads the set hint after the pipe", () => {
    expect(extractMentions("[[Charizard ex|sv03.5]]")).toEqual([
      { raw: "Charizard ex|sv03.5", name: "Charizard ex", setHint: "sv03.5" },
    ]);
  });

  it("drops duplicates regardless of case and spacing", () => {
    const mentions = extractMentions("[[Dragapult  ex]] then [[dragapult EX]]");
    expect(mentions).toHaveLength(1);
    expect(mentions[0]?.name).toBe("Dragapult ex");
  });

  it("ignores fenced blocks and inline code", () => {
    expect(extractMentions("```\n[[Dragapult ex]]\n```")).toEqual([]);
    expect(extractMentions("use `[[Dragapult ex]]` to trigger it")).toEqual([]);
  });

  it("still parses outside a code span in the same message", () => {
    const mentions = extractMentions("`[[ignored]]` but [[Pikachu]] counts");
    expect(mentions.map((mention) => mention.name)).toEqual(["Pikachu"]);
  });

  it("caps how many cards one message can pull", () => {
    const text = "[[A]] [[B]] [[C]] [[D]] [[E]]";
    expect(extractMentions(text, 3)).toHaveLength(3);
  });

  it("ignores single brackets, empty names and whitespace-only names", () => {
    expect(extractMentions("[Dragapult ex]")).toEqual([]);
    expect(extractMentions("[[]]")).toEqual([]);
    expect(extractMentions("[[   ]]")).toEqual([]);
  });

  it("collapses internal whitespace", () => {
    expect(extractMentions("[[Mega    Kangaskhan   ex]]")[0]?.name).toBe("Mega Kangaskhan ex");
  });

  it("returns nothing when there is no marker", () => {
    expect(extractMentions("Dragapult ex is fine")).toEqual([]);
  });
});
