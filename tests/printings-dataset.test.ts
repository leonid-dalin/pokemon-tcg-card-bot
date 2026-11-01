import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPrintingOf, normaliseName } from "../src/resolve.js";

interface Entry {
  id: string;
  name: string;
}

const REGIONAL = /^(alolan|galarian|hisuian|paldean)\b/i;

const NAME_PREFIXES = new Set(["mega", "team", "radiant", "shining", "dark", "light"]);
const POSSESSIVE = /^[A-Za-z0-9.\-]+'s$/;
const NAME_SUFFIXES = new Set(["ex", "gx", "v", "vmax", "vstar", "v-union", "break", "lv.x", "lv. x", "prime"]);

// The same tokeniser as isPrintingOf, without any suffix handling, so the
// contiguity check below sees every word the reader typed.
function tokensOf(name: string): string[] {
  return normaliseName(name)
    .replace(/\s+/g, " ")
    .split(" ")
    .flatMap((token) => {
      const attached = /^(.+)-((?:ex|gx|v|vmax|vstar|v-union|break|prime))$/.exec(token);
      return attached ? [attached[1]!, attached[2]!] : [token];
    })
    .filter(Boolean);
}

function containsContiguous(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((token, j) => haystack[i + j] === token)) return true;
  }
  return false;
}

describe("printings across the committed index", () => {
  const entries = JSON.parse(readFileSync("src/data/text-index.json", "utf8")) as Entry[];
  const names = [...new Set(entries.map((entry) => entry.name))];

  // Names grouped by their first token, so a printing query only meets the
  // candidates that could actually carry its words rather than every name.
  const byFirstToken = new Map<string, string[]>();
  for (const name of names) {
    const first = tokensOf(name)[0];
    if (!first) continue;
    const bucket = byFirstToken.get(first) ?? [];
    bucket.push(name);
    byFirstToken.set(first, bucket);
  }

  it("relates only names whose tokens appear whole and in order", () => {
    let related = 0;
    for (const name of names) {
      const needle = tokensOf(name);
      const bucket = byFirstToken.get(needle[0] ?? "") ?? [];
      for (const other of bucket) {
        if (other === name || !isPrintingOf(name, other)) continue;
        related += 1;
        // The matcher must not strip a suffix or swap one word for another; the
        // query's full token list has to sit inside the candidate as typed.
        expect(containsContiguous(tokensOf(other), needle), `${name} -> ${other}`).toBe(true);
        if (REGIONAL.test(other)) expect(name, `${name} -> ${other}`).toMatch(REGIONAL);
      }
    }
    expect(related).toBeGreaterThan(0);
    console.log(`printings checked ${names.length} names, ${related} relations`);
  });

  it("never drops a typed prefix or suffix on prefixed printings", () => {
    let prefixed = 0;
    for (const name of names) {
      // A name is always a printing of itself.
      expect(isPrintingOf(name, name), name).toBe(true);
      const tokens = tokensOf(name);
      const first = tokens[0] ?? "";
      const last = tokens.at(-1) ?? "";
      const hasPrefix = POSSESSIVE.test(first) || NAME_PREFIXES.has(first);
      const hasSuffix = NAME_SUFFIXES.has(last);
      if (hasPrefix && hasSuffix) {
        prefixed += 1;
        const base = tokens.slice(0, -1).join(" ");
        // The base name, without the trailing suffix, must still match the card.
        expect(isPrintingOf(base, name), `${base} -> ${name}`).toBe(true);
      }
    }
    expect(prefixed).toBeGreaterThan(0);
    console.log(`printings checked ${names.length} names, ${prefixed} prefixed printings`);
  });
}, 30_000);
