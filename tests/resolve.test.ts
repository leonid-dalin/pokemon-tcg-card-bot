import { describe, expect, it } from "vitest";
import { normaliseName, rankPrintings, resolvePrinting, scoreCandidate, seriesRank, setIdMatches, setIdOf } from "../src/resolve.js";

const printing = (id: string, name: string) => ({ id, name });

describe("normaliseName", () => {
  it("folds case, accents and spacing", () => {
    expect(normaliseName("  Pokémon   Catcher ")).toBe("pokemon catcher");
    expect(normaliseName("Mega Kangaskhan EX")).toBe("mega kangaskhan ex");
  });

  it("keeps apostrophes but normalises the curly form", () => {
    expect(normaliseName("Boss’s Orders")).toBe(normaliseName("Boss's Orders"));
  });
});

describe("set ids", () => {
  it("takes everything before the last dash", () => {
    expect(setIdOf("sv08.5-073")).toBe("sv08.5");
    expect(setIdOf("swsh3-1")).toBe("swsh3");
  });

  it("matches a set hint by exact, prefix and suffix", () => {
    expect(setIdMatches("sv08.5-073", "sv08.5")).toBe(true);
    expect(setIdMatches("sv08.5-073", "sv08")).toBe(true);
    expect(setIdMatches("sv08.5-073", "08.5")).toBe(true);
    expect(setIdMatches("sv08.5-073", "swsh3")).toBe(false);
  });
});

describe("scoreCandidate", () => {
  it("ranks exact above prefix above substring", () => {
    const exact = scoreCandidate("Dragapult ex", "Dragapult ex");
    const prefix = scoreCandidate("Dragapult", "Dragapult ex");
    const contains = scoreCandidate("Dragapult", "Shiny Dragapult");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(contains);
  });

  it("prefers the shorter name when both are prefixes", () => {
    expect(scoreCandidate("Dra", "Dragapult")).toBeGreaterThan(scoreCandidate("Dra", "Dragapult ex"));
  });

  it("matches a multi-word query whose tokens all appear", () => {
    expect(scoreCandidate("mega kangaskhan", "Mega Kangaskhan ex")).toBeGreaterThan(0);
  });

  it("scores nothing for an unrelated name", () => {
    expect(scoreCandidate("Pikachu", "Charizard ex")).toBe(0);
  });
});

describe("rankPrintings", () => {
  const cards = [
    printing("sv06-130", "Dragapult"),
    printing("sv08.5-073", "Dragapult ex"),
    printing("sv08.5-072", "Drakloak"),
  ];

  it("keeps upstream order inside equal scores", () => {
    const ranked = rankPrintings([printing("a-1", "Pikachu"), printing("b-2", "Pikachu")], "Pikachu");
    expect(ranked.map((card) => card.id)).toEqual(["a-1", "b-2"]);
  });

  it("drops non-matches", () => {
    expect(rankPrintings(cards, "Dragapult").map((card) => card.name)).toEqual(["Dragapult", "Dragapult ex"]);
  });

  it("honours a set hint", () => {
    const ranked = rankPrintings(cards, "Dragapult", "sv08.5");
    expect(ranked.map((card) => card.id)).toEqual(["sv08.5-073"]);
  });

  it("returns nothing when the set hint excludes every match", () => {
    expect(rankPrintings(cards, "Dragapult", "swsh3")).toEqual([]);
  });
});

describe("resolvePrinting", () => {
  it("separates the primary printing from the alternates", () => {
    const resolved = resolvePrinting(
      [printing("sv06-130", "Dragapult ex"), printing("sv08.5-073", "Dragapult ex")],
      "Dragapult ex",
    );
    expect(resolved?.primary.id).toBe("sv06-130");
    expect(resolved?.alternates.map((card) => card.id)).toEqual(["sv08.5-073"]);
  });

  it("returns undefined when nothing matches", () => {
    expect(resolvePrinting([printing("sv06-130", "Dragapult")], "Snorlax")).toBeUndefined();
  });
});

describe("seriesRank", () => {
  it("orders series oldest to newest", () => {
    expect(seriesRank("base1-4")).toBeLessThan(seriesRank("swsh1-1"));
    expect(seriesRank("swsh1-1")).toBeLessThan(seriesRank("sv08.5-073"));
    expect(seriesRank("sv08.5-073")).toBeLessThan(seriesRank("me01-104"));
  });

  it("reads the longer series prefix", () => {
    expect(seriesRank("swshp-1")).toBe(seriesRank("swsh1-1"));
    expect(seriesRank("mep-025")).toBe(seriesRank("me01-104"));
  });

  it("ranks the 30th anniversary sets newest", () => {
    expect(seriesRank("30th-017")).toBeGreaterThan(seriesRank("sv04.5-016"));
    expect(seriesRank("30th-c-001")).toBe(seriesRank("30th-017"));
  });

  it("returns -1 for an unknown set", () => {
    expect(seriesRank("2024sv-2")).toBe(-1);
  });
});
