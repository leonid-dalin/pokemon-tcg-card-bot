import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { acquireSingleInstanceLock } from "../src/single-instance.js";

const dir = mkdtempSync(join(tmpdir(), "card-bot-lock-unit-"));

describe("acquireSingleInstanceLock", () => {
  test("acquires the same path twice in one process (idempotent)", () => {
    const path = join(dir, "idempotent.lock");
    expect(acquireSingleInstanceLock(path)).toBe(true);
    expect(acquireSingleInstanceLock(path)).toBe(true);
  });

  test("returns false, without throwing, when the directory is missing", () => {
    const path = join(dir, "absent", "nested", "no-peers.lock");
    expect(() => acquireSingleInstanceLock(path)).not.toThrow();
    expect(acquireSingleInstanceLock(path)).toBe(false);
  });

  test("declines a leftover non-database file and names it in the message", () => {
    const path = join(dir, "garbage.lock");
    writeFileSync(path, "this file is not a sqlite database");
    const messages: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m) => {
      messages.push(String(m));
    });
    try {
      expect(acquireSingleInstanceLock(path)).toBe(false);
    } finally {
      spy.mockRestore();
    }
    expect(messages.join("\n")).toMatch(/not a SQLite database/);
  });
});
