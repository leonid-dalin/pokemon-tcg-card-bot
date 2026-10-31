import { describe, expect, it } from "vitest";
import { printedNumber, setIdForCode } from "../src/printed.js";

describe("printedNumber", () => {
  it("uses the set code and drops leading zeros", () => {
    expect(printedNumber("me04-048")).toBe("CRI 48");
    expect(printedNumber("sv06-130")).toBe("TWM 130");
    expect(printedNumber("sve-005")).toBe("SVE 5");
  });

  it("uses the set id in upper case for a Pocket set with no code", () => {
    expect(printedNumber("b4b-133")).toBe("B4B 133");
    expect(printedNumber("A1-001")).toBe("A1 1");
    expect(printedNumber("P-A-014")).toBe("P-A 14");
  });

  it("drops the subset half of a code that carries a colon", () => {
    expect(printedNumber("swsh12tg-TG23")).toBe("SIT TG23");
    expect(printedNumber("swsh12.5gg-GG01")).toBe("CRZ GG01");
  });

  it("keeps letters and digits as printed", () => {
    expect(printedNumber("swsh12tg-TG23")).toContain("TG23");
  });

  it("handles a number that is not numeric", () => {
    expect(printedNumber("sv06-130a")).toBe("TWM 130a");
  });

  it("recognises a C-series pocket set", () => {
    expect(printedNumber("c1-005")).toBe("C1 5");
    expect(printedNumber("c1-168")).toBe("C1 168");
  });

  it("shows a Promo-C card as P-C", () => {
    expect(printedNumber("pc-001")).toBe("P-C 1");
  });
});

describe("setIdForCode", () => {
  it("maps a physical set code back to its set id", () => {
    expect(setIdForCode("NVI")).toBe("bw3");
    expect(setIdForCode("nvi")).toBe("bw3");
  });

  it("prefers the base set when a code is shared with a subset set", () => {
    expect(setIdForCode("SHF")).toBe("swsh4.5");
    expect(setIdForCode("CEL")).toBe("cel25");
    expect(setIdForCode("BRS")).toBe("swsh9");
  });

  it("returns undefined for an unknown code", () => {
    expect(setIdForCode("ZZZ")).toBeUndefined();
  });
});
