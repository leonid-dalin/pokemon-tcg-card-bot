import { describe, expect, it } from "vitest";
import { energyCost } from "../src/energy.js";

describe("energyCost", () => {
  it("uses compact letters by default", () => {
    expect(energyCost(["Fighting", "Fighting", "Colorless"])).toBe("[F][F][C]");
  });

  it("uses configured emoji when available", () => {
    expect(energyCost(["Fighting", "Fighting", "Colorless"], { Fighting: "<:f:1>" })).toBe("<:f:1><:f:1>[C]");
  });

  it("keeps unknown types in full inside brackets", () => {
    expect(energyCost(["Unknown"])).toBe("[Unknown]");
  });

  it("returns an empty string for an empty cost", () => {
    expect(energyCost([])).toBe("");
    expect(energyCost(undefined)).toBe("");
  });
});