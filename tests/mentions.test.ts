import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { extractMentions, parseSearchCommand } from "../src/mentions.js";

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

  it("reads the hint through a doubled pipe", () => {
    expect(extractMentions("[[crustle||ptcgp]]")).toEqual([
      { raw: "crustle||ptcgp", name: "crustle", setHint: "ptcgp" },
    ]);
  });

  it("treats a trailing pipe with no hint as no hint", () => {
    expect(extractMentions("[[crustle|]]")).toEqual([{ raw: "crustle|", name: "crustle" }]);
  });

  it("collapses internal whitespace", () => {
    expect(extractMentions("[[Mega    Kangaskhan   ex]]")[0]?.name).toBe("Mega Kangaskhan ex");
  });

  it("returns nothing when there is no marker", () => {
    expect(extractMentions("Dragapult ex is fine")).toEqual([]);
  });
});

describe("parseSearchCommand", () => {
  const selfId = "1564749707740192818";

  it("reads the query after the mention", () => {
    expect(parseSearchCommand(`<@${selfId}> search stadium`, selfId)).toBe("stadium");
  });

  it("accepts a colon and extra spacing", () => {
    expect(parseSearchCommand(`<@${selfId}>  SEARCH:  search your deck for a Supporter`, selfId)).toBe(
      "search your deck for a Supporter",
    );
  });

  it("handles the nickname mention form", () => {
    expect(parseSearchCommand(`<@!${selfId}> search iono`, selfId)).toBe("iono");
  });

  it("returns an empty string when the keyword has no text", () => {
    expect(parseSearchCommand(`<@${selfId}> search`, selfId)).toBe("");
  });

  it("ignores a mention with no keyword", () => {
    expect(parseSearchCommand(`<@${selfId}> what does this card do`, selfId)).toBeUndefined();
  });

  it("ignores a search word that is not at the start", () => {
    expect(parseSearchCommand(`<@${selfId}> can you search stadium`, selfId)).toBeUndefined();
  });

  it("ignores a mention of a different bot", () => {
    expect(parseSearchCommand("<@999> search stadium", selfId)).toBeUndefined();
  });

  it("ignores plain text", () => {
    expect(parseSearchCommand("search stadium", selfId)).toBeUndefined();
  });
});

describe("decklist toggle", () => {
  const base = { DISCORD_TOKEN: "token", DISCORD_CLIENT_ID: "1" };

  it("stays off unless asked for", () => {
    expect(loadConfig(base).decklistEnabled).toBe(false);
  });

  it("turns on from the environment", () => {
    expect(loadConfig({ ...base, DECKLIST_ENABLED: "true" }).decklistEnabled).toBe(true);
  });
});
