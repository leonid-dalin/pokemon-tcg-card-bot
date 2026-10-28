import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvocationLog } from "../src/invocation-log.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "invocations-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ENTRY = { channelId: "c1", isAdmin: false, trigger: "[[Dragapult ex]]", reply: "card text" };

describe("InvocationLog", () => {
  it("stores the invocation without any user identifier", () => {
    const dir = tempDir();
    new InvocationLog(dir, 60).record({ ...ENTRY, guildId: "g1", isAdmin: true });
    const raw = readFileSync(join(dir, "invocations.jsonl"), "utf8");
    const stored = JSON.parse(raw) as Record<string, unknown>;
    expect(stored).toMatchObject({ guildId: "g1", channelId: "c1", isAdmin: true, trigger: ENTRY.trigger, reply: ENTRY.reply });
    expect(raw).not.toContain("userId");
    expect(raw).not.toContain("author");
    expect(raw).not.toContain("username");
    expect(Object.keys(stored)).toEqual(expect.arrayContaining(["at", "guildId", "channelId", "isAdmin", "trigger", "reply"]));
  });

  it("records nothing when no directory is configured", () => {
    const log = new InvocationLog(undefined, 60);
    expect(log.enabled).toBe(false);
    log.record(ENTRY);
    log.prune();
    expect(existsSync(join(tempDir(), "invocations.jsonl"))).toBe(false);
  });

  it("deletes entries past the retention window and keeps fresh ones", () => {
    const dir = tempDir();
    const now = Date.now();
    let current = now - 61 * 86_400_000;
    const clock = () => current;
    const log = new InvocationLog(dir, 60, clock);
    log.record({ ...ENTRY, trigger: "old message" });
    current = now;
    log.record({ ...ENTRY, trigger: "fresh message" });
    new InvocationLog(dir, 60, () => now).prune();
    const lines = readFileSync(join(dir, "invocations.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("fresh message");
  });

  it("drops every entry once the whole file is older than the retention window", () => {
    const dir = tempDir();
    const now = Date.now();
    const log = new InvocationLog(dir, 60, () => now - 61 * 86_400_000);
    log.record(ENTRY);
    new InvocationLog(dir, 60, () => now).prune();
    const lines = readFileSync(join(dir, "invocations.jsonl"), "utf8").trim();
    expect(lines).toBe("");
  });

  it("tolerates malformed lines without losing the file", () => {
    const dir = tempDir();
    const now = Date.now();
    writeFileSync(join(dir, "invocations.jsonl"), "not json at all\n", "utf8");
    new InvocationLog(dir, 60, () => now).record(ENTRY);
    new InvocationLog(dir, 60, () => now).prune();
    const lines = readFileSync(join(dir, "invocations.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Dragapult");
  });

  it("warns instead of throwing when the directory cannot be created", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = join(tempDir(), "occupied");
    writeFileSync(dir, "a file where a directory is wanted", "utf8");
    const log = new InvocationLog(dir, 60);
    expect(() => log.record(ENTRY)).not.toThrow();
    expect(warn).toHaveBeenCalledWith("could not write the invocation log");
  });

  it("creates the directory on first use", () => {
    const dir = join(tempDir(), "nested", "deeper");
    new InvocationLog(dir, 60).record(ENTRY);
    expect(existsSync(join(dir, "invocations.jsonl"))).toBe(true);
  });

  it("survives a directory that exists but is empty", () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    const log = new InvocationLog(dir, 60);
    expect(() => log.prune()).not.toThrow();
    expect(existsSync(join(dir, "invocations.jsonl"))).toBe(false);
  });
});
