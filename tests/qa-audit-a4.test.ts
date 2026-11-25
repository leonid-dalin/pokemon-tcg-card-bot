import { describe, expect, it } from "vitest";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import { lookupCard } from "../src/lookup.js";

import { getPocketCard, searchPocketByName } from "../src/api/pocket.js";

const missing = () => Object.assign(new Error("not found"), { status: 404 });
const outage = {
  searchByName: async () => { throw Object.assign(new Error("outage"), { status: 500 }); },
  getCard: async () => { throw missing(); },
} as unknown as TcgdexClient;
const healthy = {
  searchByName: async () => [{ id: "A1-285", name: "Pikachu ex", localId: "285" }],
  getCard: async (id: string) => {
    const card = getPocketCard(id);
    if (!card) throw missing();
    return card;
  },
} as unknown as TcgdexClient;

describe("A4 package fallback keeps the same-wording printing guard", () => {
  it("does not offer different-mechanics printings under an outage", async () => {
    const result = await lookupCard(outage, "a1-285", undefined);
    expect(result?.card.id.toLowerCase()).toBe("a1-285");
    const controls = result!.matchingPrintings?.map((printing) => printing.id.toLowerCase()) ?? [];
    const alternates = result!.alternates.map((printing) => printing.id.toLowerCase());
    expect(alternates).toContain("b1-321");
    expect(controls).not.toContain("b1-321");
    expect(controls.every((id) => ["a1-096", "a1-259", "a1-281"].includes(id))).toBe(true);
  });

  it("keeps the healthy-provider matching set", async () => {
    const result = await lookupCard(healthy, "A1-285", undefined);
    expect(result).toBeDefined();
    expect(result!.matchingPrintings?.some((printing) => printing.id.toLowerCase() === "b1-321")).toBe(false);
    expect(searchPocketByName("Pikachu ex").length).toBeGreaterThan(0);
  });
});
