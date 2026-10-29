import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";

const importer = readFileSync(new URL("../deploy/import-env.mjs", import.meta.url), "utf8");
const exported = new Set([...importer.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((match) => match[1]));
const loader = readFileSync(new URL("../src/config.ts", import.meta.url), "utf8");
const read = [...new Set([...loader.matchAll(/env\.([A-Z_]+)/g)].map((match) => match[1]))];

const SOURCE = [
  "UPSTREAM_CONCURRENCY=2",
  "UPSTREAM_QUEUE_LIMIT=3",
  "UPSTREAM_QUEUE_WAIT_MS=50",
  "MEMBER_LOOKUP_BURST=1",
  "MEMBER_LOOKUP_REFILL_SECONDS=60",
].join("\n");

function parse(source: string): NodeJS.ProcessEnv {
  return Object.fromEntries(
    source
      .split("\n")
      .map((line) => line.split("="))
      .filter((parts) => parts.length === 2),
  ) as NodeJS.ProcessEnv;
}

describe("native deployment import keeps every setting the loader reads", () => {
  it.each([
    "UPSTREAM_CONCURRENCY",
    "UPSTREAM_QUEUE_LIMIT",
    "UPSTREAM_QUEUE_WAIT_MS",
    "MEMBER_LOOKUP_BURST",
    "MEMBER_LOOKUP_REFILL_SECONDS",
  ])("exports %s", (key) => {
    expect(exported.has(key)).toBe(true);
  });

  it("imports every setting the loader reads, apart from host-mapped paths", () => {
    const missing = read.filter((key) => !exported.has(key) && key !== "DATA_DIR");
    expect(missing).toEqual([]);
  });

  it("preserves the requested limits when the exported values are loaded", () => {
    const config = loadConfig({
      ...parse(SOURCE),
      DISCORD_TOKEN: "token",
      DISCORD_CLIENT_ID: "123",
    });
    expect(config.upstreamConcurrency).toBe(2);
    expect(config.upstreamQueueLimit).toBe(3);
    expect(config.upstreamQueueWaitMs).toBe(50);
    expect(config.memberLookupBurst).toBe(1);
    expect(config.memberLookupRefillSeconds).toBe(60);
  });
});
