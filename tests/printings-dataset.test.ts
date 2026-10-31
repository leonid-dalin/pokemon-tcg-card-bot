import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPrintingOf } from "../src/resolve.js";

interface Entry {
  id: string;
  name: string;
}

const REGIONAL = /^(alolan|galarian|hisuian|paldean)\b/i;

describe("printings across the committed index", () => {
  it("only relates names that keep the query words in order", () => {
    const entries = JSON.parse(readFileSync("src/data/text-index.json", "utf8")) as Entry[];
    const names = [...new Set(entries.map((entry) => entry.name))];
    let checked = 0;
    let related = 0;

    for (const name of names) {
      const words = name.toLowerCase().split(/\s+/).filter(Boolean);
      for (const other of names) {
        if (other === name || !isPrintingOf(name, other)) continue;
        related += 1;
        // The matcher guarantees the query's words appear contiguously, so the
        // check here is on the words a reader sees, ignoring punctuation and case.
        const flatten = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
        expect(flatten(other), `${name} vs ${other}`).toContain(flatten(name).replace(/\b(ex|gx|v|vmax|vstar|break|prime)\b/g, "").trim());
        if (REGIONAL.test(other)) expect(name, `${name} vs ${other}`).toMatch(REGIONAL);
      }
      checked += 1;
    }

    expect(checked).toBeGreaterThan(1000);
    expect(related).toBeGreaterThan(0);
    console.log(`printings checked ${checked} names, ${related} relations`);
  }, 120_000);
});
