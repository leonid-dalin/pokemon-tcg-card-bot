import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifestFor, sha256, upsertEntry, entryFor } from "../scripts/lib/publish.js";

const ROOT = process.cwd();
const STUB = join(ROOT, "tests", "fixtures", "set-stub.mjs");
const TEXT_STUB = join(ROOT, "tests", "fixtures", "text-stub.mjs");

// tsx replaces globalThis.fetch, which would clobber the preload stub, so the
// CLI tests run the compiled output instead.
let BUILD = "";

beforeAll(() => {
  BUILD = mkdtempSync(join(tmpdir(), "pr15-build-"));
  execFileSync(process.execPath, [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", join(ROOT, "tsconfig.json"), "--outDir", BUILD], { cwd: ROOT });
});

const START_MODULE = `// Offline set metadata for lookup, ranking and printed labels.

export interface SetIndexEntry {
  id: string;
  name: string;
  code?: string;
  releaseDate?: string;
}

export const SET_INDEX: SetIndexEntry[] = [
  { id: "base1", name: "Base Set", code: "BS", releaseDate: "1999-01-09" },
];
`;

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "set-cli-"));
  const data = join(dir, "src", "data");
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, "set-index.ts"), START_MODULE, "utf8");
  return { dir, data, target: join(data, "set-index.ts"), manifest: join(data, "data-manifest.json") };
}

function runSetScript(dir: string) {
  return execFileSync(
    process.execPath,
    ["--import", `file:///${STUB.replace(/\\/g, "/")}`, join(BUILD, "scripts", "build-set-index.js")],
    { cwd: dir, encoding: "utf8", env: { ...process.env, SET_INDEX_TARGET: "src/data/set-index.ts", SET_INDEX_MANIFEST: "src/data/data-manifest.json" } },
  );
}

describe("the set generator CLI publishes its result", () => {
  it("writes the new set into the runtime module and the manifest", () => {
    const { dir, target, manifest } = scratch();
    try {
      const output = runSetScript(dir);
      expect(output).toContain("added audit-new");
      const module = readFileSync(target, "utf8");
      expect(module).toContain('id: "audit-new"');
      expect(module).toContain('code: "AN"');
      expect(module).toContain('id: "base1"');
      const written = JSON.parse(readFileSync(manifest, "utf8")) as {
        entries: { path: string; records: number; sha256: string }[];
      };
      expect(written.entries.map((entry) => entry.path)).toEqual(["src/data/set-index.ts"]);
      expect(written.entries[0]?.records).toBe(2);
      expect(written.entries[0]?.sha256).toBe(sha256(module));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is byte-stable on an unchanged second run", () => {
    const { dir, target, manifest } = scratch();
    try {
      runSetScript(dir);
      const module = readFileSync(target, "utf8");
      const manifestBytes = readFileSync(manifest, "utf8");
      runSetScript(dir);
      expect(readFileSync(target, "utf8")).toBe(module);
      expect(readFileSync(manifest, "utf8")).toBe(manifestBytes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the text generator CLI protects its inputs", () => {
  function textScratch(manifestBody: string) {
    const dir = mkdtempSync(join(tmpdir(), "text-cli-"));
    const data = join(dir, "src", "data");
    mkdirSync(data, { recursive: true });
    const target = join(data, "text-index.json");
    const manifest = join(data, "data-manifest.json");
    const original = `${JSON.stringify([{ id: "old-1", name: "Old", text: "old words", category: "Pokemon", parts: [] }])}\n`;
    writeFileSync(target, original, "utf8");
    writeFileSync(manifest, manifestBody, "utf8");
    return { dir, target, manifest, original };
  }

  function runTextScript(dir: string) {
    return execFileSync(
      process.execPath,
      ["--import", `file:///${TEXT_STUB.replace(/\\/g, "/")}`, join(BUILD, "scripts", "build-text-index.js")],
      { cwd: dir, encoding: "utf8", env: { ...process.env, TEXT_INDEX_TARGET: "src/data/text-index.json", TEXT_INDEX_MANIFEST: "src/data/data-manifest.json" } },
    );
  }

  it("publishes a new index and records it in the manifest", () => {
    const { dir, target, manifest, original } = textScratch(manifestFor("source", [
      entryFor("src/data/set-index.ts", "set-bytes", 220, "2026-01-01T00:00:00.000Z"),
    ]));
    try {
      runTextScript(dir);
      const written = JSON.parse(readFileSync(target, "utf8")) as { id: string }[];
      expect(written.map((entry) => entry.id)).toEqual(["sv01-001", "sv01-025"]);
      const recorded = JSON.parse(readFileSync(manifest, "utf8")) as { entries: { path: string; records: number }[] };
      expect(recorded.entries.map((entry) => entry.path)).toEqual([
        "src/data/set-index.ts",
        "src/data/text-index.json",
      ]);
      expect(recorded.entries[1]?.records).toBe(2);
      expect(readFileSync(target, "utf8")).not.toBe(original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves the dataset and a rejected manifest untouched", () => {
    const { dir, target, manifest, original } = textScratch("{ not json");
    try {
      let failed = false;
      try {
        runTextScript(dir);
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      expect(readFileSync(target, "utf8")).toBe(original);
      expect(readFileSync(manifest, "utf8")).toBe("{ not json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("manifest upsert ordering", () => {
  it("replaces an entry in place so an unchanged update rewrites no bytes", () => {
    const textEntry = entryFor("src/data/text-index.json", "text", 100, "2026-01-01T00:00:00.000Z");
    const setEntry = entryFor("src/data/set-index.ts", "set", 220, "2026-01-02T00:00:00.000Z");
    const before = manifestFor("source", [textEntry, setEntry]);
    const updated = upsertEntry(JSON.parse(before), "source", { ...textEntry, generatedAt: "2026-06-06T00:00:00.000Z" });
    expect(manifestFor(updated.source, updated.entries)).toBe(before);
  });
});

afterAll(() => {
  rmSync(BUILD, { recursive: true, force: true });
});
