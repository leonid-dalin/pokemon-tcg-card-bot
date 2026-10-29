import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startRuntimeStatus } from "../src/runtime-status.js";

afterEach(() => vi.useRealTimers());

describe("deployment readiness", () => {
  it("publishes current readiness and a heartbeat for the owning process", () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), "bot-status-"));
    const path = join(directory, "status.json");
    let ready = false;
    const stop = startRuntimeStatus(() => ready, path);
    const read = () => JSON.parse(readFileSync(path, "utf8"));
    try {
      expect(read()).toEqual({ pid: process.pid, ready: false, updatedAt: Date.now() });
      ready = true;
      vi.advanceTimersByTime(5_000);
      expect(read()).toEqual({ pid: process.pid, ready: true, updatedAt: Date.now() });
      ready = false;
      vi.advanceTimersByTime(5_000);
      expect(read().ready).toBe(false);
      stop();
      writeFileSync(path, "stopped");
      vi.advanceTimersByTime(5_000);
      expect(readFileSync(path, "utf8")).toBe("stopped");
    } finally {
      stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("logs a failed write and keeps the timer alive instead of throwing", () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), "bot-status-fail-"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const stop = startRuntimeStatus(() => true, join(directory, "missing", "status.json"));
      expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("status write failed"));
      stop();
    } finally {
      errorSpy.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
