import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";

test("signal handlers register once, on acquire, not on import", async () => {
  const sigintBefore = process.listenerCount("SIGINT");
  const sigtermBefore = process.listenerCount("SIGTERM");

  const { acquireSingleInstanceLock } = await import("../src/single-instance.js");

  expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
  expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);

  const lock = join(mkdtempSync(join(tmpdir(), "card-bot-sig-")), ".bot.lock");
  expect(acquireSingleInstanceLock(lock)).toBe(true);

  expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
  expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);

  expect(acquireSingleInstanceLock(lock)).toBe(true);
  expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
  expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);
});
