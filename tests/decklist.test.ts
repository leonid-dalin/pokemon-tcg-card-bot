import { describe, expect, it } from "vitest";
import { parseDecklist } from "../src/decklist.js";

const list = `Pokémon: 14
4 Dreepy TWM 128
3 Drakloak TWM 129
3 Dragapult ex TWM 130
2 Munkidori TWM 95
2 Fezandipiti ex SFA 38

Trainer: 34
4 Arven SVI 166
4 Iono PAL 185
3 Boss's Orders PAL 172
2 Night Stretcher SFA 61
4 Buddy-Buddy Poffin TEF 144
4 Ultra Ball SVI 196
4 Rare Candy SVI 191
3 Nest Ball SVI 181
2 Counter Catcher PAR 160
2 Switch SVI 194
2 Super Rod PAL 188

Energy: 12
8 Basic {P} Energy SVE 5
4 Basic {D} Energy SVE 7

Total Cards: 60`;

describe("parseDecklist", () => {
  it("reads counts, names and printings", () => {
    const deck = parseDecklist(list);
    expect(deck).toBeDefined();
    const dragapult = deck?.lines.find((line) => line.name === "Dragapult ex");
    expect(dragapult).toEqual({ count: 3, name: "Dragapult ex", setCode: "TWM", number: "130" });
  });

  it("sums the counts and keeps the declared total", () => {
    const deck = parseDecklist(list);
    expect(deck?.total).toBe(60);
    expect(deck?.lines.reduce((sum, line) => sum + line.count, 0)).toBe(60);
  });

  it("records the section headers", () => {
    const deck = parseDecklist(list);
    expect(deck?.sections.map((section) => section.label)).toEqual(["Pokémon", "Trainer", "Energy"]);
  });

  it("accepts a line with no printing", () => {
    const deck = parseDecklist(`4 Arven
4 Iono
4 Boss's Orders
4 Professor's Research
4 Nest Ball
4 Ultra Ball`);
    expect(deck?.lines[0]).toEqual({ count: 4, name: "Arven" });
  });

  it("ignores ordinary chat", () => {
    expect(parseDecklist("I think 4 Arven is correct here")).toBeUndefined();
    expect(parseDecklist("[[Dragapult ex]] is the best deck")).toBeUndefined();
  });

  it("ignores a list too short to be a deck", () => {
    expect(parseDecklist("4 Arven\n3 Iono")).toBeUndefined();
  });

  it("drops a line whose count cannot be a real card count", () => {
    const deck = parseDecklist(`40 Arven SVI 166
4 Iono PAL 185
4 Boss's Orders PAL 172
4 Nest Ball SVI 181
4 Ultra Ball SVI 196
2 Switch SVI 194`);
    expect(deck).toBeDefined();
    expect(deck?.lines.some((line) => line.count === 40)).toBe(false);
    expect(deck?.lines).toHaveLength(5);
  });
});
