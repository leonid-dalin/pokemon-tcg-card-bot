import { linkSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

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

/** A holder that is gone, unreadable or this same pid cannot be running. */
function isStale(pid: number | undefined): boolean {
  return pid === undefined || pid === process.pid || !isRunning(pid);
}

/** Registers cleanup once, so repeated acquires do not accumulate listeners. */
let registered = false;

function claim(path: string): boolean {
  if (registered) return true;
  registered = true;
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
}

/**
 * Claims the lock atomically. A candidate is written to a unique temporary file
 * and hard-linked into place, so only one process can create the link and the
 * claimed file is never briefly empty. To clear a stale holder, a process must
 * first rename it aside, and only the process that renamed it clears it.
 */
export function acquireSingleInstanceLock(path = LOCK_PATH): boolean {
  const candidate = `${path}.${process.pid}`;
  try {
    writeFileSync(candidate, String(process.pid), { mode: 0o600 });
    try {
      linkSync(candidate, path);
      return claim(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    const pid = holder(path);
    if (!isStale(pid)) {
      console.error(`another instance is already running as pid ${pid}; stop it first`);
      return false;
    }

    const aside = `${candidate}.stale`;
    try {
      renameSync(path, aside);
    } catch (error) {
      // Another process moved it first, so that process owns the claim. Anything
      // else means the stale file could not be cleared at all.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(`could not clear the stale lock at ${path} (${(error as NodeJS.ErrnoException).code ?? "unknown"})`);
      }
      return false;
    }
    // Clear only the file this process moved, and only if it is still the stale one.
    if (holder(aside) !== pid) {
      console.error(`the lock at ${path} changed while it was being cleared; not removing it`);
      return false;
    }
    unlinkSync(aside);

    try {
      linkSync(candidate, path);
      return claim(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  } finally {
    try {
      unlinkSync(candidate);
    } catch {
      // The temporary file is already gone.
    }
  }
}
