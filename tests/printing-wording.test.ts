import { describe, expect, it } from "vitest";
import { printingsForButtons } from "../src/lookup.js";
import type { Card, CardSummary } from "../src/api/types.js";

const summary = (id: string): CardSummary => ({ id, name: "Crustle" });
const card = (id: string): Card => ({ id, name: "Crustle", category: "Pokemon" }) as Card;

const crustleIds = ["bw5-8", "bw3-7", "bw7-85", "sv10-012", "sv04-007", "sm11-11"];

describe("printingsForButtons", () => {
  it("offers only printings that word the card the same way", () => {
    // The other listed Crustle printings have different indexed wording.
    const buttons = printingsForButtons(card("bw5-8"), crustleIds.map(summary));
    expect(buttons).toEqual([]);
  });

  it("keeps a reprint whose wording is identical", () => {
    // sv10-012 and sv10-186 are Crustle printings in Destined Rivals with matching wording.
    const fromDRI = printingsForButtons(card("sv10-012"), ["sv10-012", "sv10-186", "sv04-007"].map(summary));
    expect(fromDRI.map((s) => s.id)).toEqual(["sv10-186"]);
    const fromSV04 = printingsForButtons(card("sv04-007"), ["sv04-007", "sv04-183"].map(summary));
    expect(fromSV04.map((s) => s.id)).toEqual(["sv04-183"]);
  });

  it("keeps every printing for a card the index does not know", () => {
    const buttons = printingsForButtons(card("zzz9-999"), crustleIds.map(summary));
    expect(buttons).toHaveLength(crustleIds.length);
  });

  it("keeps a Great Ball reprint only when its effect is the same", () => {
    // DP7 Great Ball has a different effect; XY1 and BW2 share indexed wording.
    const fromOld = printingsForButtons({ id: "dp7-85", name: "Great Ball", category: "Trainer" } as Card, [
      { id: "xy1-118", name: "Great Ball" },
      { id: "bw2-93", name: "Great Ball" },
    ]);
    expect(fromOld.map((s) => s.id)).toEqual([]);
    const fromNew = printingsForButtons({ id: "xy1-118", name: "Great Ball", category: "Trainer" } as Card, [
      { id: "dp7-85", name: "Great Ball" },
      { id: "bw2-93", name: "Great Ball" },
    ]);
    expect(fromNew.map((s) => s.id)).toEqual(["bw2-93"]);
  });
});
