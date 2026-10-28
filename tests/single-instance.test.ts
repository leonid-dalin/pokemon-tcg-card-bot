import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireSingleInstanceLock } from "../src/single-instance.js";

const lockIn = () => join(mkdtempSync(join(tmpdir(), "card-bot-lock-")), ".bot.pid");

describe("acquireSingleInstanceLock", () => {
  it("refuses while the recorded process is alive", () => {
    const path = lockIn();
    // The test runner's parent process is alive for the whole run.
    writeFileSync(path, String(process.ppid));
    expect(acquireSingleInstanceLock(path)).toBe(false);
  });

  it("takes over a lock left by a process that is gone", () => {
    const path = lockIn();
    writeFileSync(path, "2147483646");
    expect(acquireSingleInstanceLock(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(String(process.pid));
  });
});
