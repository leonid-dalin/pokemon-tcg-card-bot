import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchingDetail, searchGroupsIn, type TextHit } from "../src/text-search.js";

const entries = JSON.parse(
  readFileSync(new URL("./fixtures/text-index-parts.json", import.meta.url), "utf8"),
) as TextHit[];

describe("search parts", () => {
  it("says an ability matched", () => {
    const group = searchGroupsIn(entries, "attach a Fighting Energy card")[0];
    expect(group?.representative.id).toBe("me04-048");
    expect(matchingDetail(group!.representative, "attach a Fighting Energy card")).toBe(
      "Ability · Battle Bond: Once during your turn, you may **attach** a **Fighting** **Energy** **card** from your hand to this Pokémon.",
    );
  });

  it("says an attack matched", () => {
    const group = searchGroupsIn(entries, "no damage counters")[0];
    expect(matchingDetail(group!.representative, "no damage counters")).toBe(
      "Attack · Gale Slash: If this Pokémon has **no** **damage** **counters** on it, this attack does 150 more **damage**.",
    );
  });

  it("says an effect matched", () => {
    const group = searchGroupsIn(entries, "attached cards back into")[0];
    expect(group?.representative.id).toBe("sv02-185");
    expect(matchingDetail(group!.representative, "attached cards back into")).toBe(
      "Effect: Choose 1 of your opponent's Active Pokémon and put it and any **attached** **cards** **back** **into** their owner's hand.",
    );
  });

  it("searches an entry without parts and leaves it unlabelled", () => {
    const legacy: TextHit[] = [{ id: "sv01-001", name: "Legacy Card", text: "draw 2 cards" }];
    const group = searchGroupsIn(legacy, "draw 2 cards")[0];
    expect(group?.representative.id).toBe("sv01-001");
    expect(matchingDetail(group!.representative, "draw 2 cards")).toBe("**draw** 2 **cards**");
  });
});
