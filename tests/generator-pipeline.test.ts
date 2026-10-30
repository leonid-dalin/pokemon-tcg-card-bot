import { describe, expect, it } from "vitest";
import { TcgdexError } from "../src/api/tcgdex.js";
import type { Card } from "../src/api/types.js";
import { searchCardText, type TextHit } from "../src/text-search.js";
import { buildTextIndex, categoryOf, partsOf, textOf } from "../scripts/lib/text-index.js";
import { describeChanges, mergeEntry, setIndexOutcome } from "../scripts/lib/set-index.js";
import type { SetIndexEntry } from "../src/data/set-index.js";

const summaries = [{ id: "a-1", name: "Alpha" }, { id: "b-1", name: "Beta" }];

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "a-1",
    name: "Alpha",
    category: "Pokemon",
    attacks: [{ name: "Strike", damage: "10", cost: [], effect: "Flip a coin." }],
  } as Card;
}

describe("text generator orchestration", () => {
  it("refuses an empty summary list before fetching anything", async () => {
    let called = 0;
    const outcome = await buildTextIndex([], async () => {
      called += 1;
      return card();
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.reason).toContain("empty");
    expect(called).toBe(0);
  });

  it("refuses a run where every card detail is missing", async () => {
    const outcome = await buildTextIndex(summaries, async () => {
      throw new TcgdexError("not found", 404);
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.reason).toContain("missing");
  });

  it("refuses a run with a transport failure instead of publishing partial text", async () => {
    const outcome = await buildTextIndex(summaries, async (id) => {
      if (id === "b-1") throw new TcgdexError("upstream 503", 503);
      return card();
    });
    expect(outcome.status).toBe("failed");
  });

  it("skips one 404 and publishes the other cards", async () => {
    const outcome = await buildTextIndex(summaries, async (id) => {
      if (id === "a-1") throw new TcgdexError("not found", 404);
      return card();
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.entries.map((entry) => entry.id)).toEqual(["b-1"]);
  });

  it("publishes a complete run", async () => {
    const outcome = await buildTextIndex(summaries, async () => card());
    expect(outcome.status).toBe("ok");
  });
});

describe("card wording extraction", () => {
  it("joins effect, abilities and attacks into one text field", () => {
    const text = textOf(card());
    expect(text).toContain("Flip a coin.");
  });

  it("classifies trainer and energy cards, defaulting to Pokemon", () => {
    expect(categoryOf({ category: "Trainer" } as Card)).toBe("Trainer");
    expect(categoryOf({ category: "Energy" } as Card)).toBe("Energy");
    expect(categoryOf({ category: "Pokemon" } as Card)).toBe("Pokemon");
  });

  it("records named parts for excerpts", () => {
    const parts = partsOf(card());
    expect(parts.some((part) => part.kind === "attack" && part.name === "Strike")).toBe(true);
  });
});

describe("set entry merge precedence", () => {
  const previous: SetIndexEntry = { id: "base1", name: "Old Name", code: "OLD", releaseDate: "1999-01-09" };

  it("prefers the detail date over the summary and the curated value", () => {
    const merged = mergeEntry({
      summary: { id: "base1", name: "Base Set", releaseDate: "1999-02-02" },
      detail: { id: "base1", name: "Base Set", releaseDate: "1999-03-03", abbreviation: { official: "BS" } },
      failed: false,
    }, previous);
    expect(merged.releaseDate).toBe("1999-03-03");
  });

  it("falls back to the summary date when the detail omits it", () => {
    const merged = mergeEntry({
      summary: { id: "base1", name: "Base Set", releaseDate: "1999-02-02" },
      detail: { id: "base1", name: "Base Set" },
      failed: false,
    }, previous);
    expect(merged.releaseDate).toBe("1999-02-02");
  });

  it("keeps the curated date when neither upstream value exists", () => {
    const merged = mergeEntry({
      summary: { id: "base1", name: "Base Set" },
      detail: { id: "base1", name: "Base Set" },
      failed: false,
    }, previous);
    expect(merged.releaseDate).toBe("1999-01-09");
  });
});


describe("set generator decisions", () => {
  const ok = { summary: { id: "sv01", name: "Scarlet & Violet" }, detail: { id: "sv01", name: "Scarlet & Violet" }, failed: false };

  it("refuses an empty set list", () => {
    const outcome = setIndexOutcome([]);
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.reason).toContain("empty");
  });

  it("refuses a run with any failed detail", () => {
    const outcome = setIndexOutcome([ok, { summary: { id: "x", name: "X" }, failed: true }]);
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.reason).toContain("1 set details failed");
  });

  it("accepts a complete run", () => {
    expect(setIndexOutcome([ok]).status).toBe("ok");
  });
});

describe("changed-field report", () => {
  const known = new Map<string, SetIndexEntry>([
    ["base1", { id: "base1", name: "Base Set", code: "BS", releaseDate: "1999-01-09" }],
    ["gone", { id: "gone", name: "Removed Set", code: "RM", releaseDate: "2000-01-01" }],
  ]);

  it("reports a name-only change without a code pair", () => {
    const lines = describeChanges([{ id: "base1", name: "Base Set (new)", code: "BS", releaseDate: "1999-01-09" }], known);
    expect(lines).toEqual(['changed base1: name "Base Set" -> "Base Set (new)"', 'removed gone']);
  });

  it("reports each changed field and a removal", () => {
    const lines = describeChanges(
      [
        { id: "base1", name: "Base Set", code: "B1", releaseDate: "1999-01-09" },
        { id: "new1", name: "New Set", code: "NW", releaseDate: "2026-01-01" },
      ],
      known,
    );
    expect(lines).toContain("changed base1: code BS -> B1");
    expect(lines).toContain("added new1");
    expect(lines).toContain("removed gone");
  });

  it("prints nothing when nothing changed", () => {
    const lines = describeChanges(
      [{ id: "base1", name: "Base Set", code: "BS", releaseDate: "1999-01-09" }],
      new Map([["base1", { id: "base1", name: "Base Set", code: "BS", releaseDate: "1999-01-09" }]]),
    );
    expect(lines).toEqual([]);
  });
});

describe("the generated shape feeds the production text search", () => {
  it("produces entries the consumer reads", async () => {
    const outcome = await buildTextIndex([{ id: "a-1", name: "Alpha" }], async () => card());
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    const generated = outcome.entries[0] as unknown as TextHit;
    expect(generated.id).toBe("a-1");
    expect(generated.text).toContain("Flip a coin.");
    expect(generated.category).toBe("Pokemon");
    expect(generated.parts?.[0]?.kind).toBe("attack");
    expect(generated.parts?.[0]?.name).toBe("Strike");
  });

  it("searches the committed index through the production consumer", () => {
    const hits = searchCardText("flip a coin");
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits.slice(0, 5)) {
      expect(hit.text.toLowerCase()).toContain("flip");
    }
  });
});
