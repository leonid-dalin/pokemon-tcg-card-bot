import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Card } from "../src/api/types.js";
import { isPocketCard, prizeCount } from "../src/prizes.js";
import { renderCard } from "../src/render.js";
import { printedNumber } from "../src/printed.js";
import { limitlessUrl } from "../src/links.js";

const evidence = JSON.parse(readFileSync("tests/fixtures/pr3-evidence.json", "utf8"));

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

  it("does not read an EX suffix into an ordinary species name", () => {
    for (const record of evidence.ordinaryCards) expect(prizeCount(record)).toBe(1);
    expect(prizeCount(card("Calyrex"))).toBe(1);
    expect(prizeCount(card("Toxapex"))).toBe(1);
  });

  it("recognises package promos as Pocket and presents them as P-A and P-B", () => {
    expect(isPocketCard({ id: "pa-014", name: "Lapras ex" } as Card)).toBe(true);
    expect(isPocketCard({ id: "pb-006", name: "Mega Pidgeot ex" } as Card)).toBe(true);
    expect(printedNumber("pa-014")).toBe("P-A 14");
    expect(printedNumber("pb-006")).toBe("P-B 6");
    expect(limitlessUrl("pa-014")).toBe("https://pocket.limitlesstcg.com/cards/P-A/14");
    expect(limitlessUrl("pb-006")).toBe("https://pocket.limitlesstcg.com/cards/P-B/6");
  });

  it("keeps ordinary Pocket and physical ids on their existing presentation", () => {
    expect(printedNumber("a1-001")).toBe("A1 1");
    expect(printedNumber("b4b-133")).toBe("B4B 133");
    expect(printedNumber("sv01-181")).toBe("SVI 181");
    expect(printedNumber("p-a-005")).toBe("P-A 5");
  });
});