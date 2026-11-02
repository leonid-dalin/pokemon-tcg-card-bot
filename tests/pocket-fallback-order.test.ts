import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TcgdexError, type TcgdexClient } from "../src/api/tcgdex.js";
import type { Card } from "../src/api/types.js";
import { POCKET_ATTRIBUTION, lookupCard, splitTrailingSet } from "../src/lookup.js";
import { normaliseName } from "../src/resolve.js";

const template = JSON.parse(readFileSync(new URL("./fixtures/dragapult-ex-sv08.5-073.json", import.meta.url), "utf8")) as Card;
const CHI_YU = { id: "me01-031", name: "Chi-Yu", localId: "031" };
const PIKACHU = { id: "me01-012", name: "Pikachu", localId: "012" };

// TCGdex matches a name as a substring, so a name plus a set code finds nothing.
const client = {
  searchByName: async (name: string) => {
    const wanted = normaliseName(name);
    return [CHI_YU, PIKACHU].filter((card) => normaliseName(card.name) === wanted);
  },
  getCard: async (id: string) => {
    const card = [CHI_YU, PIKACHU].find((entry) => entry.id === id);
    if (!card) throw new TcgdexError("not found", 404);
    return { ...template, id, name: card.name };
  },
} as unknown as TcgdexClient;

const PHYSICAL_FIRST = { allowed: "both", default: "ptcg" } as const;
const PHYSICAL_ONLY = { allowed: "ptcg", default: "ptcg" } as const;

describe("a trailing set code beats the package's partial name match", () => {
  it.each(["chi-yu Meg", "chi-yu meg", "chi-yu meg-31"])("%s finds the physical card when both games are allowed", async (query) => {
    const lookup = await lookupCard(client, query, undefined, { gamePreference: PHYSICAL_FIRST });
    expect(lookup?.card.id).toBe("me01-031");
    expect(lookup?.attribution).not.toBe(POCKET_ATTRIBUTION);
  });

  it.each(["chi-yu Meg", "chi-yu meg-31"])("%s finds the physical card on a physical-only server", async (query) => {
    const lookup = await lookupCard(client, query, undefined, { gamePreference: PHYSICAL_ONLY });
    expect(lookup?.card.id).toBe("me01-031");
  });

  it("finds it with no preference stored", async () => {
    const lookup = await lookupCard(client, "chi-yu meg-31", undefined, {});
    expect(lookup?.card.id).toBe("me01-031");
  });

  it("does not answer a code and number with a different card's name", async () => {
    // me01-031 is Chi-Yu, so "pikachu meg-31" must not return it, or a Pocket card either.
    const lookup = await lookupCard(client, "pikachu meg-31", undefined, { gamePreference: PHYSICAL_FIRST });
    expect(lookup).toBeUndefined();
  });

  it("treats a recognised set as binding, like the pipe form", async () => {
    // Chi-Yu has no card in sv03. The pipe form is a miss, so the trailing form is too,
    // rather than the package answering with an unrelated Pocket card.
    expect(await lookupCard(client, "chi-yu", "sv03", { gamePreference: PHYSICAL_FIRST })).toBeUndefined();
    expect(await lookupCard(client, "chi-yu sv03", undefined, { gamePreference: PHYSICAL_FIRST })).toBeUndefined();
  });

  it("keeps the package fallback when the last word is not a set", async () => {
    const lookup = await lookupCard(client, "chi-yu zzzz", undefined, { gamePreference: PHYSICAL_FIRST });
    expect(lookup?.attribution).toBe(POCKET_ATTRIBUTION);
  });

  it("keeps an explicit set hint in charge", async () => {
    const lookup = await lookupCard(client, "chi-yu", "meg", { gamePreference: PHYSICAL_FIRST });
    expect(lookup?.card.id).toBe("me01-031");
  });
});

describe("splitTrailingSet reads a printed code and number", () => {
  it("turns code-number into a code and a number", () => {
    expect(splitTrailingSet("chi-yu meg-31")).toEqual({ name: "chi-yu", setHint: "meg 31" });
  });

  it("leaves a word that is not a set code before the number", () => {
    expect(splitTrailingSet("chi-yu zzz-31")).toBeUndefined();
  });

  it("leaves a set code that is not followed by a card number", () => {
    expect(splitTrailingSet("chi-yu meg-abc")).toBeUndefined();
  });
});
