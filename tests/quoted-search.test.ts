import { describe, expect, it } from "vitest";
import { normaliseName } from "../src/resolve.js";
import { searchCardGroups, unquote } from "../src/text-search.js";
import { PageStore } from "../src/discord/pages.js";
import { searchReply } from "../src/discord/replies.js";

const QUERY = "opponent's deck and discard";
const groupsFor = (query: string) => searchCardGroups(query);

describe("quoted search", () => {
  it("searches the words when the query is wrapped in double quotes", () => {
    expect(groupsFor(`"${QUERY}"`).length).toBe(groupsFor(QUERY).length);
  });

  it("searches the words when the query is wrapped in single quotes", () => {
    expect(groupsFor(`'${QUERY}'`).length).toBe(groupsFor(QUERY).length);
  });

  it("searches the words when the query is wrapped in curly double quotes", () => {
    expect(groupsFor(`\u201c${QUERY}\u201d`).length).toBe(groupsFor(QUERY).length);
  });

  it("searches the words when the query is wrapped in curly single quotes", () => {
    expect(groupsFor(`\u2018${QUERY}\u2019`).length).toBe(groupsFor(QUERY).length);
  });

  it("finds Miss Fortune Sisters once the quotes come off", () => {
    const found = groupsFor(`"${QUERY}"`).find((group) => group.representative.name === "Miss Fortune Sisters");
    expect(found?.representative.id).toBe("swsh11-164");
  });

  it("keeps a quote inside the query as a real character", () => {
    expect(unquote(`"${QUERY}"`)).toBe(QUERY);
    expect(unquote(`rocket's "catcher"`)).toBe(`rocket's "catcher"`);
    expect(normaliseName(`team rocket's`)).toBe("team rocket's");
  });

  it("leaves an unmatched quote alone rather than guessing", () => {
    expect(unquote(`"${QUERY}`)).toBe(`"${QUERY}`);
  });
});

describe("empty result message", () => {
  const reply = (query: string) => searchReply(query, [], "Card data from TCGdex", "1", new PageStore());

  it("names the quotes when the query was quoted", () => {
    expect(reply(`"zzz"`)).toEqual({
      content: "No card wording mentions `zzz`. The words were searched; the quote marks are matched literally, so a card would have to print them.",
    });
  });

  it("stays short when the query has no quotes", () => {
    expect(reply("zzz")).toEqual({ content: "No card wording mentions `zzz`." });
  });
});
