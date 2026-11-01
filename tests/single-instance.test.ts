import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireSingleInstanceLock } from "../src/single-instance.js";

const lockIn = () => join(mkdtempSync(join(tmpdir(), "card-bot-lock-")), ".bot.pid");

describe("acquireSingleInstanceLock", () => {
  it("refuses while the recorded process is alive", () => {
    const path = lockIn();
    // The test runner's parent process is alive for the whole run.
    writeFileSync(path, String(process.ppid));
    expect(acquireSingleInstanceLock(path)).toBe(false);
    // A refused claim must leave the holder's file untouched.
    expect(readFileSync(path, "utf8")).toBe(String(process.ppid));
    rmSync(path, { force: true });
  });

  it("takes over a lock left by a process that is gone", () => {
    const path = lockIn();
    writeFileSync(path, "2147483646");
    expect(acquireSingleInstanceLock(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(String(process.pid));
    rmSync(path, { force: true });
  });

  it("claims a path that does not exist yet", () => {
    const path = lockIn();
    expect(acquireSingleInstanceLock(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(String(process.pid));
    rmSync(path, { force: true });
  });

  it("treats its own pid in the file as stale, as a restarted container would", () => {
    const path = lockIn();
    writeFileSync(path, String(process.pid));
    expect(acquireSingleInstanceLock(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(String(process.pid));
    rmSync(path, { force: true });
  });

  it("accepts a second acquire attempt in the same process", () => {
    const path = lockIn();
    expect(acquireSingleInstanceLock(path)).toBe(true);
    expect(acquireSingleInstanceLock(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(String(process.pid));
    rmSync(path, { force: true });
  });

  it("takes over a lock file whose contents are not a pid", () => {
    const path = lockIn();
    writeFileSync(path, "not-a-pid");
    expect(acquireSingleInstanceLock(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(String(process.pid));
    rmSync(path, { force: true });
  });
});

describe("stale lock clearing", () => {
  it("leaves no temporary files behind after claiming", () => {
    const path = lockIn();
    writeFileSync(path, "999999");

    expect(acquireSingleInstanceLock(path)).toBe(true);
    const leftovers = readdirSync(dirname(path)).filter((name) => name !== basename(path));
    expect(leftovers).toEqual([]);
    rmSync(path, { force: true });
  });

  it("does not clear a lock that a live process claimed in the meantime", () => {
    const path = lockIn();
    writeFileSync(path, "999999");

    // Claim it as if another process won the race, then try to take it.
    writeFileSync(path, String(process.ppid));
    expect(acquireSingleInstanceLock(path)).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(String(process.ppid));
    rmSync(path, { force: true });
  });

  it("registers exit cleanup once across repeated acquires", () => {
    const path = lockIn();
    const before = process.listenerCount("exit");
    acquireSingleInstanceLock(path);
    acquireSingleInstanceLock(path);
    acquireSingleInstanceLock(path);
    expect(process.listenerCount("exit") - before).toBeLessThanOrEqual(1);
    rmSync(path, { force: true });
  });
});
