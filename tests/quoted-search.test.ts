import { describe, expect, it } from "vitest";
import { normaliseName } from "../src/resolve.js";
import { searchCardGroups, unquote } from "../src/text-search.js";
import { PageStore } from "../src/discord/pages.js";
import { searchReply } from "../src/discord/replies.js";

const QUERY = "opponent's deck and discard";
const groupsFor = (query: string) => searchCardGroups(query);

describe("quoted search", () => {
  it("narrows to the phrase when the query is wrapped in double quotes", () => {
    expect(groupsFor(`"${QUERY}"`).length).toBeLessThan(groupsFor(QUERY).length);
    expect(groupsFor(`"${QUERY}"`).length).toBeGreaterThan(0);
  });

  it("reads single and curly quotes the same way", () => {
    const phrase = groupsFor(`"${QUERY}"`).length;
    expect(groupsFor(`'${QUERY}'`).length).toBe(phrase);
    expect(groupsFor(`\u201c${QUERY}\u201d`).length).toBe(phrase);
    expect(groupsFor(`\u2018${QUERY}\u2019`).length).toBe(phrase);
  });

  it("finds Miss Fortune Sisters, which prints the phrase", () => {
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

  it("names the phrase when the query was quoted", () => {
    expect(reply(`"zzz"`)).toEqual({
      content: "No card wording mentions `zzz`. A quoted search needs those words printed in that order.",
    });
  });

  it("stays short when the query has no quotes", () => {
    expect(reply("zzz")).toEqual({ content: "No card wording mentions `zzz`." });
  });
});
