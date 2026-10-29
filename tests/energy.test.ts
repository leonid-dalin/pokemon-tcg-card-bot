import { describe, expect, it } from "vitest";
import { energyCost } from "../src/energy.js";

describe("energyCost", () => {
  it("joins every type inside one bracket", () => {
    expect(energyCost(["Psychic", "Psychic", "Psychic", "Colorless"])).toBe("[PPPC]");
  });

  it("keeps the order when the types alternate", () => {
    expect(energyCost(["Fighting", "Colorless", "Fighting"])).toBe("[FCF]");
  });

  it("uses configured emoji when available", () => {
    expect(energyCost(["Fighting", "Fighting", "Colorless"], { Fighting: "<:f:1>" })).toBe("<:f:1><:f:1>[C]");
  });

  it("repeats an emoji once per entry", () => {
    expect(energyCost(["Fighting", "Fighting"], { Fighting: "<:f:1>" })).toBe("<:f:1><:f:1>");
  });

  it("keeps unknown types in full inside brackets", () => {
    expect(energyCost(["Unknown"])).toBe("[Unknown]");
  });

  it("returns an empty string for an empty cost", () => {
    expect(energyCost([])).toBe("");
    expect(energyCost(undefined)).toBe("");
  });
});