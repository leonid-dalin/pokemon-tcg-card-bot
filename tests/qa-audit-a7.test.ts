import { describe, expect, it } from "vitest";
import { parseDecklist } from "../src/decklist.js";
import { renderDecklist } from "../src/render.js";

const deckText = [
  "Pokemon: 12",
  "4 Charmander MEW 4",
  "4 Charizard ex OBF 125",
  "4 Pidgeot ex OBF 164",
  "Trainer: 36",
  "4 N NVI 101",
  "4 Switch SVI 194",
  "4 Arven SVI 166",
  "4 Nest Ball SVI 181",
  "4 Ultra Ball SVI 196",
  "4 Iono PAL 185",
  "4 Rare Candy SVI 191",
  "4 Boss's Orders PAL 172",
  "4 Buddy-Buddy Poffin TEF 144",
  "Energy: 12",
  "12 Fire Energy SVE 2",
  "Total Cards: 60",
].join("\n");

describe("A7 decklists retain a real one-character name", () => {
  it("parses the N line and its four copies", () => {
    const deck = parseDecklist(deckText)!;
    const line = deck.lines.find((entry) => entry.name === "N");
    expect(line).toEqual({ count: 4, name: "N", setCode: "NVI", number: "101" });
    expect(deck.lines.reduce((sum, entry) => sum + entry.count, 0)).toBe(60);
  });

  it("resolves the N line through the real index", async () => {
    const { resolveDeckCards } = await import("../src/deck-check.js");
    const { TcgdexClient } = await import("../src/api/tcgdex.js");
    const api = new TcgdexClient({ retries: 0, timeoutMs: 12000 });
    const deck = parseDecklist(deckText)!;
    const resolution = await resolveDeckCards(api, deck);
    expect(resolution?.lines.find((entry) => entry.line.name === "N")?.card?.id).toBe("bw3-101");
  });

  it("renders every declared copy", () => {
    const deck = parseDecklist(deckText)!;
    const fields = renderDecklist(deck).fields;
    expect(fields.find((field) => field.name === "Cards")?.value).toBe("60");
    expect(renderDecklist(deck).description).toContain("4 N (NVI 101)");
  });
});
