import { describe, expect, it } from "vitest";
import { printingsForButtons } from "../src/lookup.js";
import type { Card, CardSummary } from "../src/api/types.js";

const summary = (id: string): CardSummary => ({ id, name: "Crustle" });
const card = (id: string): Card => ({ id, name: "Crustle", category: "Pokemon" }) as Card;

const crustleIds = ["bw5-8", "bw3-7", "bw7-85", "sv10-012", "sv04-007", "sm11-11"];

describe("printingsForButtons", () => {
  it("offers only printings that word the card the same way", () => {
    // Crustle DEX 8's wording is unique to its printing, so no button may
    // pretend DRI 12 or any other set is the same card.
    const buttons = printingsForButtons(card("bw5-8"), crustleIds.map(summary));
    expect(buttons).toEqual([]);
  });

  it("keeps a reprint whose wording is identical", () => {
    // sv10-012 and sv10-186 are the same Crustle card twice in Destined Rivals
    // (regular and reverse holo), so each stays reachable from the other.
    const fromDRI = printingsForButtons(card("sv10-012"), ["sv10-012", "sv10-186", "sv04-007"].map(summary));
    expect(fromDRI.map((s) => s.id)).toEqual(["sv10-186"]);
    const fromSV04 = printingsForButtons(card("sv04-007"), ["sv04-007", "sv04-183"].map(summary));
    expect(fromSV04.map((s) => s.id)).toEqual(["sv04-183"]);
  });

  it("keeps every printing for a card the index does not know", () => {
    const buttons = printingsForButtons(card("zzz9-999"), crustleIds.map(summary));
    expect(buttons).toHaveLength(crustleIds.length);
  });

  it("keeps every printing for a trainer, whose wording never changes", () => {
    const nest = ["sv01-181", "sv03.5-150"].map((id) => ({ id, name: "Nest Ball" }));
    // The category bypass keeps every other candidate; the card itself is never its own button.
    const buttons = printingsForButtons({ id: "sv01-181", name: "Nest Ball", category: "Trainer" } as Card, nest);
    expect(buttons).toHaveLength(1);
  });
});
