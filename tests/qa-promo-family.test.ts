import { describe, expect, it } from "vitest";
import { indexedText, promoNativeAlias } from "../src/text-search.js";

describe("promo aliases keep their family letter", () => {
  it("maps all supported printed families to their native aliases", () => {
    expect(promoNativeAlias("P-A-023")).toBe("pa-023");
    expect(promoNativeAlias("P-B-103")).toBe("pb-103");
    expect(promoNativeAlias("P-C-002")).toBe("pc-002");
    expect(promoNativeAlias("A1-096")).toBeUndefined();
  });

  it("keeps the current Promo-A index lookup working", () => {
    expect(indexedText("pa-023")).toBe(indexedText("P-A-023"));
    expect(indexedText("pb-103")).toBeUndefined();
    expect(indexedText("pc-002")).toBeUndefined();
  });
});
