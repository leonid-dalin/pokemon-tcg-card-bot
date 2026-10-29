import { createHash } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
