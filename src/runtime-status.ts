import { renameSync, writeFileSync } from "node:fs";

export function startRuntimeStatus(isReady: () => boolean, path = process.env.BOT_STATUS_FILE): () => void {
  if (!path) return () => {};
  const publish = () => {
    const next = `${path}.tmp`;
    writeFileSync(next, JSON.stringify({ pid: process.pid, ready: isReady(), updatedAt: Date.now() }), { mode: 0o600 });
    renameSync(next, path);
  };
  publish();
  const timer = setInterval(publish, 5_000);
  timer.unref();
  return () => clearInterval(timer);
}
