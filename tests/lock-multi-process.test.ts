import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
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
  await ready;

  expect(acquireSingleInstanceLock(lock)).toBe(false);

  child.kill("SIGKILL");
  await new Promise<void>((resolve) => child.on("exit", () => resolve()));

  expect(acquireSingleInstanceLock(lock)).toBe(true);
}, 30_000);
