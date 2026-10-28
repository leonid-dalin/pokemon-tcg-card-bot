import { describe, expect, it } from "vitest";
import { matchingSentence } from "../src/text-search.js";

const LONG =
  "This attack does 30 damage to each of your opponent's Benched Pokémon that has any damage counters on it, and if any of your opponent's Pokémon are Knocked Out by this damage, you may put a card from your discard pile into your hand, then look at the top card of their deck and put it on the bottom of their deck.";

describe("excerpt window", () => {
  it("shows the match that sits at the end of a long sentence", () => {
    const out = matchingSentence(LONG, "bottom of their deck");
    expect(out).toContain("**bottom**");
    expect(out.length).toBeLessThanOrEqual(160);
  });

  it("does not anchor on a common word that appears early", () => {
    // `of` appears at character 35; anchoring there would hide the real match.
    const out = matchingSentence(LONG, "bottom of their deck");
    expect(out).not.toBe(matchingSentence(LONG, "of"));
  });

  it("marks a cut at the start as well as the end", () => {
    const out = matchingSentence(LONG, "bottom of their deck");
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  it("leaves a short sentence whole", () => {
    const short = "Discard a card from your hand.";
    expect(matchingSentence(short, "hand")).toBe("Discard a card from your **hand**.");
  });

  it("keeps the short-sentence behaviour for a single match", () => {
    expect(matchingSentence("Put it on the bottom of their deck.", "bottom")).toBe("Put it on the **bottom** of their deck.");
  });
});
