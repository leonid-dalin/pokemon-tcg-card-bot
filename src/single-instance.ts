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
    // A dead pid, or one this process may not signal, cannot be running.
    return false;
  }
}

function holder(path: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    // A missing or unreadable file has no holder to report.
    return undefined;
  }
}

/** Filesystems that cannot hard link report one of these instead of creating it. */
const LINK_UNSUPPORTED = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "EMLINK", "EACCES"]);

/** A holder that is gone, unreadable or this same pid cannot be running. */
function isStale(pid: number | undefined): boolean {
  return pid === undefined || pid === process.pid || !isRunning(pid);
}

const registered = new Set<string>();

function claim(path: string): boolean {
  if (registered.has(path)) return true;
  registered.add(path);
  const release = () => {
    try {
      if (holder(path) === process.pid) unlinkSync(path);
    } catch {
      // The lock file is already gone.
    }
  };
  process.on("exit", release);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  return true;
}

/**
 * Creates the lock from an already-written candidate. Returns false when another
 * process holds the path. A filesystem that cannot hard link falls back to an
 * exclusive create, which still keeps two starters apart but cannot guarantee the
 * file is never briefly empty.
 */
function createLock(candidate: string, path: string): boolean {
  try {
    linkSync(candidate, path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return false;
    if (!LINK_UNSUPPORTED.has(code ?? "")) throw error;
  }
  try {
    writeFileSync(path, String(process.pid), { flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/**
 * Claims the lock. A candidate is written to a unique file and hard-linked into
 * place, so the claimed file is never briefly empty. A stale holder is renamed
 * aside, which only one process can do, and the cleared slot is then claimed. A
 * narrow window remains between the rename and the new claim, during which a fast
 * starter can take the slot.
 */
export function acquireSingleInstanceLock(path = LOCK_PATH): boolean {
  const candidate = `${path}.${process.pid}`;
  try {
    writeFileSync(candidate, String(process.pid), { mode: 0o600 });
    if (createLock(candidate, path)) return claim(path);

    const pid = holder(path);
    if (!isStale(pid)) {
      console.error(`another instance is already running as pid ${pid}; stop it first`);
      return false;
    }

    // Only one process may clear the stale file, so the takeover itself is the
    // exclusive resource rather than the lock file it is about to remove.
    const takeover = `${path}.takeover`;
    try {
      writeFileSync(takeover, String(process.pid), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A marker left by a process that died mid-takeover would block startup for
      // ever, so a marker naming a dead pid is removed and the check retried once.
      if (!isStale(holder(takeover))) return false;
      try {
        unlinkSync(takeover);
        writeFileSync(takeover, String(process.pid), { flag: "wx", mode: 0o600 });
      } catch {
        // Another process recovered the marker first and now owns the takeover.
        return false;
      }
    }
    try {
      return clearStale(candidate, path, pid, claim);
    } finally {
      try {
        unlinkSync(takeover);
      } catch {
        // The marker is already gone.
      }
    }
  } finally {
    try {
      unlinkSync(candidate);
    } catch {
      // The candidate is already gone.
    }
  }
}

/** Moves a stale lock aside and claims the freed path, under the takeover marker. */
function clearStale(candidate: string, path: string, pid: number | undefined, claim: (path: string) => boolean): boolean {
    const aside = `${candidate}.stale`;
    try {
      renameSync(path, aside);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Only one process can move the stale file, so a failure means another
      // process owns the takeover. EPERM on Windows means it was deleted.
      if (code !== "ENOENT" && code !== "EPERM") {
        console.error(`could not move the stale lock at ${path} (${code ?? "unknown"})`);
      }
      return false;
    }

    if (holder(aside) !== pid) {
      // The file changed since it was read, so a live claim now owns the path.
      // Give it back rather than leave a running instance without a lock file.
      try {
        linkSync(aside, path);
      } catch {
        // A newer claim already took the path, which is the better outcome.
      }
      try {
        unlinkSync(aside);
      } catch {
        // The moved copy is gone already.
      }
      return false;
    }
    try {
      unlinkSync(aside);
    } catch (error) {
      console.error(`could not remove the stale copy at ${aside} (${(error as NodeJS.ErrnoException).code ?? "unknown"})`);
      return false;
    }
    if (!createLock(candidate, path)) return false;
    return claim(path);
}
