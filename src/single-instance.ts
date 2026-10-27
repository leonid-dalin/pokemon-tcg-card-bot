import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const LOCK_PATH = ".bot.pid";

function isRunning(pid: number): boolean {
  try {
    // Signal 0 performs the permission and existence check without signalling.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Refuse to start a second copy. Two instances sharing one token both answer
 * every mention, so a single prompt produces two replies and nothing in the
 * logs looks wrong from either process.
 */
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
      // already gone
    }
  };
  process.on("exit", release);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  return true;
}
