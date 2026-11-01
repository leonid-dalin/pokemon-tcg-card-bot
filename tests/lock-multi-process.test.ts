import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "vitest";
import { acquireSingleInstanceLock } from "../src/single-instance.js";

const childScript = fileURLToPath(new URL("./lock-child.ts", import.meta.url));

test("a second process is refused, then reacquires after the first is killed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "card-bot-lock-mp-"));
  const lock = join(dir, ".bot.lock");

  const child = spawn(process.execPath, ["--import", "tsx", childScript, lock], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const ready = new Promise<void>((resolve, reject) => {
    let out = "";
    child.stdout!.on("data", (chunk) => {
      out += chunk.toString();
      if (out.includes("READY")) resolve();
    });
    child.stderr!.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!out.includes("READY")) reject(new Error(`child exited before ready (code ${code})`));
    });
  });
  try {
    await ready;

    expect(acquireSingleInstanceLock(lock)).toBe(false);

    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.on("exit", () => resolve()));

    expect(acquireSingleInstanceLock(lock)).toBe(true);
  } finally {
    if (!child.killed) child.kill("SIGKILL");
    // Best effort: Windows refuses to remove a directory while a handle is open.
    // A cleanup failure must not mask an assertion failure.
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // The module holds the lock file for the process life, so the directory can
      // survive on Windows. The OS clears the temp tree later.
    }
  }
}, 30_000);
