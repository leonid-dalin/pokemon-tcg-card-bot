import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
let lock: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lock-marker-"));
  lock = join(dir, ".bot.pid");
  vi.resetModules();
});

afterEach(() => {
  delete process.env.LOCK_PATH;
  vi.doUnmock("node:fs");
  vi.resetModules();
  rmSync(dir, { recursive: true, force: true });
});

async function load() {
  return import("../src/single-instance.js");
}

describe("a takeover marker that is still empty", () => {
  it("is not treated as stale while its owner is writing it", async () => {
    const { acquireSingleInstanceLock } = await load();
    writeFileSync(lock, "2147483646");
    // Created but not yet written, which is what an exclusive create looks like
    // to a reader that arrives first.
    writeFileSync(`${lock}.takeover`, "");

    expect(acquireSingleInstanceLock(lock)).toBe(false);
    expect(readFileSync(lock, "utf8")).toBe("2147483646");
  });
});

describe("a lock that becomes live while the marker is taken", () => {
  it("stands down instead of clearing a live holder", async () => {
    const livePid = process.ppid;
    writeFileSync(lock, "2147483646");
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      let taken = false;
      return {
        ...actual,
        openSync: (path: never, flag: never, mode: never) => {
          const fd = actual.openSync(path, flag, mode);
          if (!taken && String(path).endsWith(".takeover")) {
            taken = true;
            actual.writeFileSync(process.env.LOCK_PATH!, String(livePid));
          }
          return fd;
        },
      };
    });
    const { acquireSingleInstanceLock } = await load();
    process.env.LOCK_PATH = lock;

    expect(acquireSingleInstanceLock(lock)).toBe(false);
    expect(readFileSync(lock, "utf8")).toBe(String(livePid));
  });
});

describe("a refused start", () => {
  it("says why when a live instance holds the lock", async () => {
    const { acquireSingleInstanceLock } = await load();
    writeFileSync(lock, String(process.ppid));
    const said = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(acquireSingleInstanceLock(lock)).toBe(false);
    expect(said).toHaveBeenCalledWith(expect.stringContaining(String(process.ppid)));
    said.mockRestore();
  });
});


describe("a refused takeover", () => {
  it("says why when another process is already clearing the lock", async () => {
    const { acquireSingleInstanceLock } = await load();
    writeFileSync(lock, "2147483646");
    writeFileSync(`${lock}.takeover`, String(process.ppid));
    const said = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(acquireSingleInstanceLock(lock)).toBe(false);
    expect(said).toHaveBeenCalledWith(expect.stringContaining("clearing"));
    said.mockRestore();
  });
});

describe("recovering a marker left by a dead process", () => {
  it("lets exactly one of two recoverers through", async () => {
    const { acquireSingleInstanceLock } = await load();
    writeFileSync(lock, "2147483646");
    writeFileSync(`${lock}.takeover`, "2147483645");

    const first = acquireSingleInstanceLock(lock);
    const leftovers = readdirSync(dir).filter((name) => name.includes("recover"));
    expect(first).toBe(true);
    expect(leftovers).toEqual([]);
  });
});

describe("directory cleanliness", () => {
  it("leaves only the lock after a clean acquire", async () => {
    const { acquireSingleInstanceLock } = await load();
    writeFileSync(lock, "2147483646");

    expect(acquireSingleInstanceLock(lock)).toBe(true);
    expect(readdirSync(dir)).toEqual([".bot.pid"]);
    expect(existsSync(lock)).toBe(true);
  });
});
