import { renameSync, writeFileSync } from "node:fs";
import { errorCategory } from "./diagnostics.js";

export function startRuntimeStatus(isReady: () => boolean, path = process.env.BOT_STATUS_FILE): () => void {
  if (!path) return () => {};
  const publish = () => {
    // A failed status write must never reach the caller's timer callback; the next
    // interval retries and consumers treat the stale file as not ready by timestamp.
    try {
      const next = `${path}.tmp`;
      writeFileSync(next, JSON.stringify({ pid: process.pid, ready: isReady(), updatedAt: Date.now() }), { mode: 0o600 });
      renameSync(next, path);
    } catch (error) {
      console.error(`status write failed (${errorCategory(error)})`);
    }
  };
  publish();
  const timer = setInterval(publish, 5_000);
  timer.unref();
  return () => clearInterval(timer);
}
