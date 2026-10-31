import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
let lock: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lock-fallback-"));
  lock = join(dir, ".bot.pid");
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("node:fs");
  vi.resetModules();
  rmSync(dir, { recursive: true, force: true });
});

/** A filesystem that refuses hard links, as a bind mount or network share can. */
async function moduleWithoutLinks() {
  vi.doMock("node:fs", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    return {
      ...actual,
      linkSync: () => {
        const error = new Error("operation not supported") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      },
    };
  });
  return import("../src/single-instance.js");
}

describe("lock acquisition without hard links", () => {
  it("falls back to an exclusive create instead of crashing", async () => {
    const { acquireSingleInstanceLock } = await moduleWithoutLinks();

    expect(acquireSingleInstanceLock(lock)).toBe(true);
    expect(readFileSync(lock, "utf8")).toBe(String(process.pid));
  });

  it("still refuses a live holder through the fallback", async () => {
    const { acquireSingleInstanceLock } = await moduleWithoutLinks();
    writeFileSync(lock, String(process.ppid));

    expect(acquireSingleInstanceLock(lock)).toBe(false);
    expect(readFileSync(lock, "utf8")).toBe(String(process.ppid));
  });
});
