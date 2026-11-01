import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
let lock: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lock-interleave-"));
  lock = join(dir, ".bot.pid");
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("node:fs");
  vi.resetModules();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Drives the real acquire function through the interleaving where the stale file
 * is replaced by a live claim between being read and being cleared.
 */
async function moduleWithLiveReplacement(livePid: number) {
  vi.doMock("node:fs", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    let replaced = false;
    return {
      ...actual,
      renameSync: (from: string, to: string) => {
        actual.renameSync(from, to);
        if (!replaced && from === process.env.LOCK_PATH) {
          replaced = true;
          actual.writeFileSync(to, String(livePid));
        }
      },
    };
  });
  return import("../src/single-instance.js");
}

describe("a live lock replaced while a stale one is cleared", () => {
  it("does not report a win when the moved file names a live holder", async () => {
    const livePid = process.ppid;
    process.env.LOCK_PATH = lock;
    writeFileSync(lock, "2147483646");
    const { acquireSingleInstanceLock } = await moduleWithLiveReplacement(livePid);

    const won = acquireSingleInstanceLock(lock);

    expect(won).toBe(false);
    expect(readFileSync(lock, "utf8")).toBe(String(livePid));
    delete process.env.LOCK_PATH;
  });

  it("leaves no stale copy behind", async () => {
    const livePid = process.ppid;
    process.env.LOCK_PATH = lock;
    writeFileSync(lock, "2147483646");
    const { acquireSingleInstanceLock } = await moduleWithLiveReplacement(livePid);

    acquireSingleInstanceLock(lock);

    expect(readdirSync(dir).filter((name) => name !== ".bot.pid")).toEqual([]);
    delete process.env.LOCK_PATH;
  });
});
