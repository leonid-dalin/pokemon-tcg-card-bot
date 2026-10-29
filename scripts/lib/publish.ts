import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ManifestEntry {
  path: string;
  records: number;
  sha256: string;
  generatedAt: string;
}

export interface Manifest {
  version: 1;
  source: string;
  entries: ManifestEntry[];
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Writes through a temporary file in the same directory and renames it into place,
 * so an interrupted write leaves the previous file intact rather than truncated.
 */
export function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(temporary, content, "utf8");
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function entryFor(path: string, content: string, records: number, generatedAt: string): ManifestEntry {
  return { path, records, sha256: sha256(content), generatedAt };
}

export function manifestFor(source: string, entries: ManifestEntry[]): string {
  return `${JSON.stringify({ version: 1, source, entries } satisfies Manifest, null, 1)}\n`;
}

export function readManifest(path: string): Manifest | undefined {
  if (!existsSync(path)) return undefined;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Manifest>;
  if (parsed.version !== 1 || typeof parsed.source !== "string" || !Array.isArray(parsed.entries)) {
    throw new Error(`manifest at ${path} has an unexpected shape`);
  }
  for (const entry of parsed.entries) {
    if (
      typeof entry.path !== "string" ||
      typeof entry.records !== "number" ||
      typeof entry.sha256 !== "string" ||
      typeof entry.generatedAt !== "string"
    ) {
      throw new Error(`manifest at ${path} has a malformed entry`);
    }
  }
  return parsed as Manifest;
}

/**
 * Replaces one dataset's entry and keeps the rest. A dataset whose bytes and
 * record count are unchanged keeps its original generatedAt, so an identical
 * regeneration leaves the manifest byte-identical.
 */
export function upsertEntry(manifest: Manifest | undefined, source: string, entry: ManifestEntry): Manifest {
  const existing = manifest?.entries ?? [];
  const unchanged = existing.find(
    (held) => held.path === entry.path && held.sha256 === entry.sha256 && held.records === entry.records,
  );
  const stored = unchanged ? { ...entry, generatedAt: unchanged.generatedAt } : entry;
  // Replace in place so an unchanged update rewrites no bytes at all.
  const replaced = existing.some((held, index) => {
    if (held.path !== entry.path) return false;
    existing[index] = stored;
    return true;
  });
  const entries = replaced ? existing : [...existing, stored];
  return { version: 1, source: manifest?.source ?? source, entries };
}
