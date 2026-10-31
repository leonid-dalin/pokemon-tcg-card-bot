#!/usr/bin/env node
// Runs several processes against one lock and reports how often more than one
// claimed it. Unit tests cannot observe this race, so it is checked here.
// Usage: node scripts/lock-race-check.mjs [processes] [rounds]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const processes = Number.parseInt(process.argv[2] ?? "6", 10);
const rounds = Number.parseInt(process.argv[3] ?? "40", 10);
const modulePath = new URL("../dist/src/single-instance.js", import.meta.url).href;
const racer = `
const { acquireSingleInstanceLock } = await import(process.env.LOCK_MODULE);
const ok = acquireSingleInstanceLock(process.env.LOCK_PATH);
process.stdout.write(ok ? "W" : "L");
setTimeout(() => process.exit(0), 200);
`;

let doubleWinners = 0;
for (let round = 0; round < rounds; round += 1) {
  const dir = mkdtempSync(join(tmpdir(), "lock-race-"));
  const lock = join(dir, ".bot.pid");
  writeFileSync(lock, "999999");
  const racerPath = join(dir, "racer.mjs");
  writeFileSync(racerPath, racer);
  const results = await Promise.all(
    Array.from({ length: processes }, () =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [racerPath], {
          env: { ...process.env, LOCK_MODULE: modulePath, LOCK_PATH: lock },
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

console.log(`processes=${processes} rounds=${rounds} rounds without exactly one winner=${doubleWinners}`);
process.exit(doubleWinners === 0 ? 0 : 1);
