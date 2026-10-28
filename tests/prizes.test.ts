import { describe, expect, it } from "vitest";
import type { Card } from "../src/api/types.js";
import { isPocketCard, prizeCount } from "../src/prizes.js";
import { renderCard } from "../src/render.js";

const card = (name: string, id = "sv01-001"): Card => ({ id, name, category: "Pokemon" });

describe("prizeCount", () => {
  it.each([
    ["Mega Gallade ex", 3],
    ["Dragapult ex", 2],
    ["M Charizard EX", 2],
    ["Lapras GX", 2],
    ["Pheromosa & Buzzwole GX", 3],
    ["Gengar VMAX", 3],
    ["Lugia VSTAR", 2],
    ["Lugia V", 2],
    ["Marshadow", 1],
    ["Raichu", 1],
  ])("counts %s as %s", (name, expected) => {
    expect(prizeCount(card(name))).toBe(expected);
  });

  it("uses Pocket points for a Mega ex card", () => {
    const pocket: Card = { id: "b2-001", name: "Mega Absol ex", category: "Pokemon", points: 3 };
    expect(isPocketCard(pocket)).toBe(true);
    expect(prizeCount(pocket)).toBe(3);
    expect(renderCard(pocket).description).toContain("3 Points");
  });
});