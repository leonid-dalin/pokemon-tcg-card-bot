import { linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

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
 * Claims the lock so two starting processes cannot both hold it. A candidate is
 * written to a unique file and hard-linked into place, so the claimed file is
 * never briefly empty. Clearing a stale holder copies it aside first and removes
 * the original only while it still holds the pid that was read; if it has been
 * replaced by a live claim, that claim is left untouched.
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

    const aside = `${candidate}.stale`;
    try {
      linkSync(path, aside);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return false;
      if (LINK_UNSUPPORTED.has(code ?? "")) {
        try {
          unlinkSync(path);
        } catch {
          return false;
        }
        if (!createLock(candidate, path)) return false;
        return claim(path);
      }
      throw error;
    }

    if (holder(aside) !== pid) {
      try {
        unlinkSync(aside);
      } catch {
      }
      return false;
    }
    try {
      unlinkSync(aside);
      unlinkSync(path);
    } catch (error) {
      console.error(`could not clear the stale lock at ${path} (${(error as NodeJS.ErrnoException).code ?? "unknown"})`);
      return false;
    }
    if (!createLock(candidate, path)) return false;
    return claim(path);
  } finally {
    try {
      unlinkSync(candidate);
    } catch {
    }
  }
}
