import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entryFor, manifestFor, sha256, writeAtomic } from "../scripts/lib/publish.js";
import { mergeEntry, renderModule, sortEntries, splitModule } from "../scripts/lib/set-index.js";
import type { SetIndexEntry } from "../src/data/set-index.js";

const TARGET = new URL("../src/data/set-index.ts", import.meta.url);

describe("set index rendering", () => {
  it("round-trips the shipped index byte for byte", () => {
    const source = readFileSync(TARGET, "utf8");
    const parsed = splitModule(source);
    expect(renderModule(parsed.entries, parsed.header)).toBe(source);
  });

  it("parses every entry in the shipped index", () => {
    const source = readFileSync(TARGET, "utf8");
    const parsed = splitModule(source);
    expect(parsed.entries).toHaveLength((source.match(/\{ id: /g) ?? []).length);
    expect(parsed.entries.filter((entry) => entry.code).length).toBeGreaterThan(0);
  });

  it("keeps a curated code when the upstream record omits it", () => {
    const previous: SetIndexEntry = { id: "base1", name: "Base Set", code: "BS", releaseDate: "1999-01-09" };
    const merged = mergeEntry(
      { summary: { id: "base1", name: "Base Set" }, detail: { id: "base1", name: "Base Set" }, failed: false },
      previous,
    );
    expect(merged.code).toBe("BS");
    expect(merged.releaseDate).toBe("1999-01-09");
  });

  it("prefers the upstream code when one is supplied", () => {
    const previous: SetIndexEntry = { id: "base1", name: "Base Set", code: "OLD" };
    const merged = mergeEntry(
      { summary: { id: "base1", name: "Base Set" }, detail: { id: "base1", name: "Base Set", abbreviation: { official: "BS" } }, failed: false },
      previous,
    );
    expect(merged.code).toBe("BS");
  });

  it("reads the code from the nested official field upstream sends", () => {
    const merged = mergeEntry({
      summary: { id: "sv01", name: "Scarlet & Violet" },
      detail: { id: "sv01", name: "Scarlet & Violet", abbreviation: { official: "SVI" } },
      failed: false,
    });
    expect(merged.code).toBe("SVI");
    expect(typeof merged.code).toBe("string");
  });

  it("accepts a plain-string abbreviation from an older snapshot", () => {
    const merged = mergeEntry({
      summary: { id: "base1", name: "Base Set" },
      detail: { id: "base1", name: "Base Set", abbreviation: "BS" as never },
      failed: false,
    });
    expect(merged.code).toBe("BS");
  });

  it("maps the upstream abbreviation to the runtime code field", () => {
    const merged = mergeEntry({
      summary: { id: "sv01", name: "Scarlet & Violet" },
      detail: { id: "sv01", name: "Scarlet & Violet", abbreviation: { official: "SVI" }, releaseDate: "2023-03-31" },
      failed: false,
    });
    expect(merged).toEqual({ id: "sv01", name: "Scarlet & Violet", code: "SVI", releaseDate: "2023-03-31" });
  });

  it("sorts by release date then id so an unchanged source renders identically", () => {
    const entries: SetIndexEntry[] = [
      { id: "b", name: "B", releaseDate: "2020-01-01" },
      { id: "a", name: "A", releaseDate: "2020-01-01" },
      { id: "c", name: "C", releaseDate: "2019-01-01" },
    ];
    expect(sortEntries(entries).map((entry) => entry.id)).toEqual(["c", "a", "b"]);
  });
});

describe("atomic publication", () => {
  it("leaves the previous file intact when the write fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      const target = join(dir, "data.ts");
      writeFileSync(target, "original", "utf8");
      expect(() => writeAtomic(join(dir, "missing", "\0bad"), "replacement")).toThrow();
      expect(readFileSync(target, "utf8")).toBe("original");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replaces the file and adds no temporary files", () => {
    const dir = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      const target = join(dir, "data.ts");
      writeFileSync(target, "original", "utf8");
      writeAtomic(target, "replacement");
      expect(readFileSync(target, "utf8")).toBe("replacement");
      const { readdirSync } = require("node:fs") as typeof import("node:fs");
      expect(readdirSync(dir)).toEqual(["data.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("data manifest", () => {
  it("records counts and hashes that agree with the rendered file", () => {
    const content = "export const SET_INDEX = [];\n";
    const entry = entryFor("src/data/set-index.ts", content, 0, "2026-10-29T00:00:00.000Z");
    const manifest = JSON.parse(manifestFor("source", [entry]));
    expect(manifest.version).toBe(1);
    expect(manifest.entries[0].records).toBe(0);
    expect(manifest.entries[0].sha256).toBe(sha256(content));
  });

  it("changes the hash when the content changes", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });
});
