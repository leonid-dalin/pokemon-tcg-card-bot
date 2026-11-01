import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
let lock: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lock-fault-"));
  lock = join(dir, ".bot.pid");
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("node:fs");
  vi.resetModules();
  rmSync(dir, { recursive: true, force: true });
});

async function load() {
  return import("../src/single-instance.js");
}

describe("a leftover empty candidate", () => {
  it("is replaced rather than linked in as the live lock", async () => {
    // A crash between create and write leaves this behind for a reused pid. A
    // container restart reuses pid 1, so this is the common case.
    const candidate = `${lock}.${process.pid}`;
    writeFileSync(candidate, "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(candidate, old, old);

    const { acquireSingleInstanceLock } = await load();
    expect(acquireSingleInstanceLock(lock)).toBe(true);

    // The claimed lock names this process rather than being empty.
    expect(readFileSync(lock, "utf8")).toBe(String(process.pid));
    expect(existsSync(candidate)).toBe(false);
  });
});

describe("an unreadable moved lock", () => {
  it("declines instead of throwing", async () => {
    let injected = false;
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        readFileSync: (path: never, options: never) => {
          if (String(path).endsWith(".stale")) {
            injected = true;
            throw Object.assign(new Error("permission denied"), { code: "EACCES" });
          }
          return actual.readFileSync(path, options);
        },
      };
    });
    writeFileSync(lock, "2147483646");
    const { acquireSingleInstanceLock } = await load();

    expect(acquireSingleInstanceLock(lock)).toBe(false);
    expect(injected).toBe(true);
  });
});

describe("a moved lock that cannot be read", () => {
  it("drops the stale copy instead of leaving it behind", async () => {
    let injected = false;
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        readFileSync: (path: never, options: never) => {
          if (String(path).endsWith(".stale")) {
            injected = true;
            throw Object.assign(new Error("permission denied"), { code: "EACCES" });
          }
          return actual.readFileSync(path, options);
        },
      };
    });
    writeFileSync(lock, "2147483646");
    const candidate = `${lock}.${process.pid}`;
    const { clearStale } = await load();

    expect(clearStale(candidate, lock, 2147483646)).toBe(false);
    expect(injected).toBe(true);
    expect(existsSync(`${candidate}.stale`)).toBe(false);
  });
});

describe("a link that fails mid-claim", () => {
  it("declines instead of throwing", async () => {
    let injected = false;
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        linkSync: () => {
          injected = true;
          throw Object.assign(new Error("no such file or directory"), { code: "ENOENT" });
        },
      };
    });
    writeFileSync(lock, "2147483646");
    const { acquireSingleInstanceLock } = await load();

    expect(acquireSingleInstanceLock(lock)).toBe(false);
    expect(injected).toBe(true);
  });
});
