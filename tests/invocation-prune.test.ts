import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findExactCardName } from "../src/text-search.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "invocation-prune-"));
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("node:fs");
  vi.resetModules();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-10-31T12:00:00Z");
const stale = JSON.stringify({ at: "2020-01-01T00:00:00Z", channelId: "c-old", isAdmin: false, trigger: "a", reply: "b" });
const fresh = JSON.stringify({ at: "2026-10-30T00:00:00Z", channelId: "c-fresh", isAdmin: false, trigger: "c", reply: "d" });
const late = JSON.stringify({ at: "2026-10-31T11:59:00Z", channelId: "c-late", isAdmin: false, trigger: "e", reply: "f" });

describe("pruning the invocation log", () => {
  it("drops expired entries and keeps fresh ones", async () => {
    const file = join(dir, "invocations.jsonl");
    writeFileSync(file, `${stale}\n${fresh}\n`);
    const { InvocationLog } = await import("../src/invocation-log.js");

    new InvocationLog(dir, 60, () => NOW).prune();

    const kept = readFileSync(file, "utf8");
    expect(kept).toContain("c-fresh");
    expect(kept).not.toContain("c-old");
  });
});

describe("finding a card by exact name", () => {
  it("returns a card whose name matches exactly", () => {
    expect(findExactCardName("Pikachu")?.name.toLowerCase()).toBe("pikachu");
  });

  it("ignores surrounding whitespace and case", () => {
    expect(findExactCardName("  PIKACHU ")).toEqual(findExactCardName("Pikachu"));
  });
});
