import { describe, expect, it } from "vitest";
import { resolveSetHint, setRecency, setEntry } from "../src/set-index.js";
import { SET_INDEX } from "../src/data/set-index.js";

describe("set index coverage", () => {
  it("indexes every set TCGdex publishes", () => {
    expect(SET_INDEX.length).toBeGreaterThan(200);
  });

  it("gives a code to every set that has one", () => {
    const withCode = SET_INDEX.filter((entry) => entry.code);
    expect(withCode.length).toBeGreaterThanOrEqual(190);
  });

  it("has a release date for every set", () => {
    expect(SET_INDEX.every((entry) => entry.releaseDate)).toBe(true);
  });
});

describe("resolveSetHint", () => {
  it("accepts the printed code in any case", () => {
    expect(resolveSetHint("SCR")).toBe("sv07");
    expect(resolveSetHint("scr")).toBe("sv07");
    expect(resolveSetHint("TEF")).toBe("sv05");
    expect(resolveSetHint("PAF")).toBe("sv04.5");
    expect(resolveSetHint("PGO")).toBe("swsh10.5");
    expect(resolveSetHint("30C")).toBe("30th-c");
  });

  it("accepts the set id", () => {
    expect(resolveSetHint("sv07")).toBe("sv07");
    expect(resolveSetHint("swsh10.5")).toBe("swsh10.5");
  });

  it("accepts the set name, including a partial one", () => {
    expect(resolveSetHint("Stellar Crown")).toBe("sv07");
    expect(resolveSetHint("stellar crown")).toBe("sv07");
    expect(resolveSetHint("Stellar")).toBe("sv07");
  });

  it("returns undefined for nonsense", () => {
    expect(resolveSetHint("zzz")).toBeUndefined();
    expect(resolveSetHint("")).toBeUndefined();
  });
});

describe("setRecency", () => {
  it("ranks by real release date", () => {
    expect(setRecency("30th-017")).toBeGreaterThan(setRecency("sv04.5-016"));
    expect(setRecency("sv04.5-016")).toBeGreaterThan(setRecency("swsh10.5-055"));
    expect(setRecency("swsh10.5-055")).toBeGreaterThan(setRecency("ex12-8"));
  });

  it("looks up a set entry by id", () => {
    expect(setEntry("sv07")?.name).toBe("Stellar Crown");
    expect(setEntry("nope")).toBeUndefined();
  });
});
