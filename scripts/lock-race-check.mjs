#!/usr/bin/env node
// Races several processes for one stale lock and reports how many rounds let more
// than one win. Racers wait for a shared start time, because spawning them in
// sequence leaves little overlap and hides the bug. Unit tests cannot observe it.
// Usage: node scripts/lock-race-check.mjs [processes] [rounds] [fallback]
// "fallback" forces every hard link to fail, exercising the exclusive-create path.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const processes = Number.parseInt(process.argv[2] ?? "6", 10);
const rounds = Number.parseInt(process.argv[3] ?? "40", 10);
const forceFallback = process.argv[4] === "fallback";
const modulePath = new URL("../dist/src/single-instance.js", import.meta.url).href;
const racer = `
const start = Number(process.env.RACE_START);
while (Date.now() < start) {}
if (process.env.RACE_FALLBACK === "1") {
  // Present as a filesystem that cannot hard link, as a bind mount can. The ESM
  // namespace is read-only, so patch the CommonJS binding and resync it.
  const { createRequire } = await import("node:module");
  const { syncBuiltinESMExports } = await import("node:module");
  const fs = createRequire(import.meta.url)("node:fs");
  fs.linkSync = () => {
    const error = new Error("operation not supported");
    error.code = "EPERM";
    throw error;
  };
  syncBuiltinESMExports();
}
const { acquireSingleInstanceLock } = await import(process.env.LOCK_MODULE);
const ok = acquireSingleInstanceLock(process.env.LOCK_PATH);
process.stdout.write(ok ? "W" : "L");
setTimeout(() => process.exit(0), 500);
`;

let doubleWinners = 0;
for (let round = 0; round < rounds; round += 1) {
  const dir = mkdtempSync(join(tmpdir(), "lock-race-"));
  const lock = join(dir, ".bot.pid");
  writeFileSync(lock, "2147483646");
  const racerPath = join(dir, "racer.mjs");
  writeFileSync(racerPath, racer);
  // Far enough ahead that every child is waiting before any of them can start.
  const start = Date.now() + 1200;
  const results = await Promise.all(
    Array.from({ length: processes }, () =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [racerPath], {
          env: { ...process.env, LOCK_MODULE: modulePath, LOCK_PATH: lock, RACE_START: String(start), RACE_FALLBACK: forceFallback ? "1" : "0" },
        });
        let out = "";
        let err = "";
        child.stdout.on("data", (chunk) => (out += chunk));
        child.stderr.on("data", (chunk) => (err += chunk));
        child.on("close", () => resolve(out.trim() || ("ERR " + err.split("\n")[0])));
      }),
    ),
  );
  const winners = results.filter((result) => result === "W").length;
  if (winners !== 1) doubleWinners += 1;
  rmSync(dir, { recursive: true, force: true });
}

console.log(`processes=${processes} rounds=${rounds} fallback=${forceFallback} rounds without exactly one winner=${doubleWinners}`);
process.exit(doubleWinners === 0 ? 0 : 1);
