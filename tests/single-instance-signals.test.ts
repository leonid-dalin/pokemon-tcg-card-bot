import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";

test("signal handlers register once, on acquire, not on import", async () => {
  const sigintBefore = process.listenerCount("SIGINT");
  const sigtermBefore = process.listenerCount("SIGTERM");

  const { acquireSingleInstanceLock } = await import("../src/single-instance.js");

  // Importing the module must not install the handlers.
  expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
  expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);

  const lock = join(mkdtempSync(join(tmpdir(), "card-bot-sig-")), ".bot.lock");
  expect(acquireSingleInstanceLock(lock)).toBe(true);

  // A successful acquire installs exactly one of each.
  expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
  expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);

  // Repeated successful acquires must not register them again.
  expect(acquireSingleInstanceLock(lock)).toBe(true);
  expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
  expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);
});
