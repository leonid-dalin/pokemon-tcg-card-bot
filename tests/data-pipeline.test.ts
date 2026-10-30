import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entryFor, manifestFor, readManifest, sha256, upsertEntry, writeAtomic } from "../scripts/lib/publish.js";
import { mergeEntry, renderModule, sortEntries, splitModule } from "../scripts/lib/set-index.js";
import type { SetIndexEntry } from "../src/data/set-index.js";

const TARGET = new URL("../src/data/set-index.ts", import.meta.url);

describe("manifest upsert", () => {
  const setEntry = entryFor("src/data/set-index.ts", "set-bytes", 220, "2026-01-01T00:00:00.000Z");
  const textEntry = entryFor("src/data/text-index.json", "text-bytes", 100, "2026-01-02T00:00:00.000Z");

  it("preserves a sibling entry when upserting", () => {
    const existing = manifestFor("source", [textEntry, setEntry]);
    const updated = upsertEntry(readManifestFrom(existing), "source", { ...setEntry, sha256: "new" });
    expect(updated.entries.map((entry) => entry.path)).toEqual(["src/data/text-index.json", "src/data/set-index.ts"]);
  });

  it("keeps generatedAt when the dataset bytes are unchanged", () => {
    const existing = manifestFor("source", [setEntry]);
    const updated = upsertEntry(readManifestFrom(existing), "source", { ...setEntry, generatedAt: "2026-06-06T00:00:00.000Z" });
    expect(updated.entries[0]?.generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("updates generatedAt when the bytes change", () => {
    const existing = manifestFor("source", [setEntry]);
    const updated = upsertEntry(readManifestFrom(existing), "source", { ...setEntry, sha256: "changed", generatedAt: "2026-06-06T00:00:00.000Z" });
    expect(updated.entries[0]?.generatedAt).toBe("2026-06-06T00:00:00.000Z");
  });

  it("rejects a malformed manifest instead of replacing it", () => {
    const dir = mkdtempSync(join(tmpdir(), "manifest-"));
    try {
      const file = join(dir, "data-manifest.json");
      for (const bad of ["{ not json", JSON.stringify({ version: 2, source: "s", entries: [] }), JSON.stringify({ version: 1, source: "s", entries: [{ path: 1 }] })]) {
        writeFileSync(file, bad, "utf8");
        expect(() => readManifest(file)).toThrow();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the known sha256 answer for abc", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("committed data manifest", () => {
  const DATASETS = ["src/data/set-index.ts", "src/data/text-index.json"];

  it("lists every generated dataset", () => {
    const manifest = JSON.parse(readFileSync("src/data/data-manifest.json", "utf8")) as { entries: { path: string }[] };
    expect(manifest.entries.map((entry) => entry.path).sort()).toEqual([...DATASETS].sort());
  });

  it("agrees with the files it names", () => {
    const manifest = JSON.parse(readFileSync("src/data/data-manifest.json", "utf8")) as {
      entries: { path: string; records: number; sha256: string }[];
    };
    for (const entry of manifest.entries) {
      const content = readFileSync(entry.path, "utf8");
      expect(sha256(content)).toBe(entry.sha256);
      if (entry.path.endsWith(".json")) {
        expect(JSON.parse(content).length).toBe(entry.records);
      } else {
        expect((content.match(/\{ id: /g) ?? []).length).toBe(entry.records);
      }
    }
  });
});

function readManifestFrom(text: string) {
  return JSON.parse(text) as Parameters<typeof upsertEntry>[0];
}


describe("set index rendering", () => {
  it("round-trips the shipped index byte for byte", () => {
    const source = readFileSync(TARGET, "utf8");
    const parsed = splitModule(source);
    expect(renderModule(parsed.entries, parsed.header)).toBe(source);
  });

  it("ships unique ids in the declared sort order", () => {
    const parsed = splitModule(readFileSync(TARGET, "utf8"));
    const ids = parsed.entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(parsed.entries).toEqual(sortEntries(parsed.entries));
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
  it("leaves the previous file intact and no temporary file when the write fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      // A directory where the target belongs makes the rename fail after the
      // temporary file has been written.
      const target = join(dir, "data.ts");
      mkdirSync(target);
      writeFileSync(join(target, "keep"), "x", "utf8");
      expect(() => writeAtomic(target, "replacement")).toThrow();
      expect(readdirSync(dir)).toEqual(["data.ts"]);
      expect(readdirSync(target)).toEqual(["keep"]);
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
