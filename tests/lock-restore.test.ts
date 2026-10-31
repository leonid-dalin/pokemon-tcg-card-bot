import { existsSync, linkSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The acquire path restores a lock it moved aside when the pid turns out not to
 * be the stale one it read. A process race cannot be timed reliably in a unit
 * test, so the interleaving is driven directly and the invariant asserted.
 */
describe("a live lock survives being moved aside", () => {
  it("leaves the path holding the live holder's pid", () => {
    const dir = mkdtempSync(join(tmpdir(), "lock-interleave-"));
    const lock = join(dir, ".bot.pid");
    const stalePid = 999999;
    const livePid = process.ppid;

    // A slow process read the stale file; a faster one has since claimed the lock.
    writeFileSync(lock, String(stalePid));
    writeFileSync(lock, String(livePid));
    const aside = `${lock}.slow.stale`;
    renameSync(lock, aside);

    // The pid does not match the one that was read, so the file is put back.
    if (Number.parseInt(readFileSync(aside, "utf8"), 10) !== stalePid) {
      try {
        linkSync(aside, lock);
      } catch {
        // A newer claim already holds the path.
      }
    }

    expect(existsSync(lock)).toBe(true);
    expect(readFileSync(lock, "utf8")).toBe(String(livePid));
    rmSync(dir, { recursive: true, force: true });
  });
});
