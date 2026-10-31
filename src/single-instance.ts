import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

// Relative to the process CWD by default; the entry point passes the data
// directory when configured so the lock does not depend on the CWD.
const LOCK_PATH = ".bot.pid";

function isRunning(pid: number): boolean {
  try {
    // Signal 0 checks whether the process exists without sending a signal.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function holder(path: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Claims the lock by creating it exclusively, so two processes starting at once
 * cannot both succeed. A holder that is gone, or that is this same pid (a
 * restarted container often reuses PID 1), leaves a stale file to clear.
 */
export function acquireSingleInstanceLock(path = LOCK_PATH): boolean {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, String(process.pid), { flag: "wx", mode: 0o600 });
      const release = () => {
        try {
          if (holder(path) === process.pid) unlinkSync(path);
        } catch {
          // Lock cleanup is best-effort.
        }
      };
      process.on("exit", release);
      process.on("SIGINT", () => process.exit(0));
      process.on("SIGTERM", () => process.exit(0));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = holder(path);
      // An unreadable or self-owned lock is stale: nothing live holds it.
      const stale = pid === undefined || pid === process.pid || !isRunning(pid);
      if (!stale) {
        console.error(`another instance is already running as pid ${pid}; stop it first`);
        return false;
      }
      try {
        unlinkSync(path);
      } catch {
        return false;
      }
    }
  }
  console.error(`could not claim ${path}; another instance may be starting`);
  return false;
}
