import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchingDetail, searchGroupsIn, type TextHit } from "../src/text-search.js";

const entries = JSON.parse(
  readFileSync(new URL("./fixtures/text-index-parts.json", import.meta.url), "utf8"),
) as TextHit[];

describe("search parts", () => {
  it("says an ability matched", () => {
    const group = searchGroupsIn(entries, "discard a water energy")[0];
    expect(group?.representative.id).toBe("30th-c-009");
    const detail = matchingDetail(group!.representative, "discard a water energy");
    expect(detail.startsWith("Ability · Giant Water Shuriken: ")).toBe(true);
    expect(detail).toContain("you may **discard** a **Water**");
  });

  it("says an attack matched", () => {
    const group = searchGroupsIn(entries, "any damage counters")[0];
    expect(group?.representative.id).toBe("2022swsh-14");
    const detail = matchingDetail(group!.representative, "any damage counters");
    expect(detail.startsWith("Attack · Berkshire: ")).toBe(true);
    expect(detail).toContain("**damage** **counters**");
  });

  it("says an effect matched", () => {
    const group = searchGroupsIn(entries, "discard any number of item")[0];
    expect(group?.representative.id).toBe("swsh11-164");
    const detail = matchingDetail(group!.representative, "discard any number of item");
    expect(detail.startsWith("Effect: ")).toBe(true);
    expect(detail).toContain("**discard** **any** **number** **of** **Item**");
  });

  it("searches an entry without parts and leaves it unlabelled", () => {
    const legacy: TextHit[] = [{ id: "sv01-001", name: "Legacy Card", text: "draw 2 cards" }];
    const group = searchGroupsIn(legacy, "draw 2 cards")[0];
    expect(group?.representative.id).toBe("sv01-001");
    expect(matchingDetail(group!.representative, "draw 2 cards")).toBe("**draw** 2 **cards**");
  });
});
