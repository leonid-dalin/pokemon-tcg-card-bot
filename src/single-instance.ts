import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

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

/** Checks the PID file for an existing instance and registers exit cleanup. */
export function acquireSingleInstanceLock(path = LOCK_PATH): boolean {
  if (existsSync(path)) {
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    if (Number.isFinite(pid) && pid !== process.pid && isRunning(pid)) {
      console.error(`another instance is already running as pid ${pid}; stop it first`);
      return false;
    }
  }

  writeFileSync(path, String(process.pid));
  const release = () => {
    try {
      if (Number.parseInt(readFileSync(path, "utf8").trim(), 10) === process.pid) unlinkSync(path);
    } catch {
      // Lock cleanup is best-effort.
    }
  };
  process.on("exit", release);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  return true;
}
