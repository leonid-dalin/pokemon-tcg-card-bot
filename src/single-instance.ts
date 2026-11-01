import { closeSync, linkSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";

// Relative to the process CWD by default; the entry point passes the data
// directory when configured so the lock does not depend on the CWD.
const LOCK_PATH = ".bot.pid";

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Only ESRCH proves the process is gone. Without permission to signal it the
    // holder may well be alive, so the lock must not be taken over.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function holder(path: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch (error) {
    // A missing file has no holder; anything else leaves the answer unknown.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Filesystems that cannot hard link report one of these instead of creating it. */
const LINK_UNSUPPORTED = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "EMLINK", "EACCES"]);

function isStale(pid: number | undefined): boolean {
  return pid === undefined || pid === process.pid || !isRunning(pid);
}

/**
 * Creates path exclusively and writes pid through the same descriptor, so a file
 * that exists is never empty. Without O_EXCL the create cannot be atomic.
 */
function claimExclusive(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    writeSync(fd, String(process.pid));
  } catch (error) {
    // Leaving an empty file behind would block every later start until removed.
    unlinkSync(path);
    throw error;
  } finally {
    closeSync(fd);
  }
  return true;
}

/**
 * Creates the lock from an already-written candidate. Returns false when another
 * process holds the path. A filesystem that cannot hard link falls back to an
 * exclusive create.
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
  return claimExclusive(path);
}

const registered = new Set<string>();

function claim(path: string): boolean {
  if (registered.has(path)) return true;
  registered.add(path);
  // Lock cleanup is best-effort: the process is exiting either way.
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

/** An empty marker younger than this belongs to a process still writing it. */
const MARKER_WRITE_GRACE_MS = 5_000;

function isEmptyMarker(path: string): boolean {
  try {
    return readFileSync(path, "utf8").trim() === "";
  } catch {
    // A missing marker is not an empty one.
    return false;
  }
}

function isFreshEmptyLock(path: string): boolean {
  try {
    return readFileSync(path, "utf8").trim() === "" && Date.now() - statSync(path).mtimeMs <= MARKER_WRITE_GRACE_MS;
  } catch {
    return false;
  }
}

function isAbandonedMarker(path: string): boolean {
  try {
    return isEmptyMarker(path) && Date.now() - statSync(path).mtimeMs > MARKER_WRITE_GRACE_MS;
  } catch {
    return false;
  }
}

/**
 * Takes the exclusive marker, or returns undefined when another process holds it.
 * A marker naming a dead pid, or an empty one its owner never finished writing, is
 * recovered. Recovery is serialised by a rename so two processes cannot both do it.
 */
function takeMarker(marker: string, candidate: string): number | undefined {
  if (createLock(candidate, marker)) return process.pid;
  const abandoned = isAbandonedMarker(marker);
  if (!abandoned) {
    const pid = holder(marker);
    // An empty marker is held: its owner has created it but not yet written it.
    if (pid === undefined || !isStale(pid)) return undefined;
  }

  const recovered = `${marker}.${process.pid}.recover`;
  try {
    renameSync(marker, recovered);
  } catch {
    // Another process moved it first, so that process owns the recovery.
    return undefined;
  }
  // The file may have been replaced between reading it and moving it, in which
  // case it belongs to a live process and goes back untouched.
  const moved = holder(recovered);
  const movedIsHeld = isEmptyMarker(recovered) ? !isAbandonedMarker(recovered) : !isStale(moved);
  if (movedIsHeld) {
    try {
      linkSync(recovered, marker);
    } catch {
      // A newer marker owns the path, so the moved copy is no longer needed.
      try {
        unlinkSync(recovered);
      } catch {
        // The moved marker is gone already.
      }
      return undefined;
    }
    try {
      unlinkSync(recovered);
    } catch {
      // The moved marker is gone already.
    }
    return undefined;
  }
  try {
    unlinkSync(recovered);
  } catch {
    // The moved marker is gone already.
  }
  return createLock(candidate, marker) ? process.pid : undefined;
}

/**
 * Claims the lock. A candidate is written to a unique file and hard-linked into
 * place, so the claimed file is never briefly empty. Clearing a stale holder is
 * serialised by the takeover marker, and the holder is judged stale again after
 * the marker is taken, so a claim that arrived in between is respected.
 */
export function acquireSingleInstanceLock(path = LOCK_PATH): boolean {
  const candidate = `${path}.${process.pid}`;
  try {
    if (!claimExclusive(candidate)) {
      // A crash between create and write leaves an empty candidate for this pid,
      // which a container restart reuses. Replace it and claim again.
      unlinkSync(candidate);
      if (!claimExclusive(candidate)) {
        console.error(`could not claim the lock candidate at ${candidate}`);
        return false;
      }
    }
  } catch (error) {
    console.error(`could not write the lock candidate at ${candidate} (${(error as NodeJS.ErrnoException).code ?? "unknown"})`);
    return false;
  }
  try {
    try {
      if (createLock(candidate, path)) return claim(path);
      return takeStale(candidate, path);
    } catch (error) {
      // Acquisition reports and declines rather than crashing startup.
      console.error(`could not acquire the lock at ${path} (${(error as NodeJS.ErrnoException).code ?? "unknown"})`);
      return false;
    }
  } finally {
    try {
      unlinkSync(candidate);
    } catch {
      // The candidate is already gone.
    }
  }
}

function takeStale(candidate: string, path: string): boolean {
  const takeover = `${path}.takeover`;
  let taken: number | undefined;
  try {
    taken = takeMarker(takeover, candidate);
  } catch (error) {
    // A marker that cannot be created or written must not crash startup.
    console.error(`could not take the takeover marker at ${takeover} (${(error as NodeJS.ErrnoException).code ?? "unknown"})`);
    return false;
  }
  if (taken === undefined) {
    console.error(`another instance is clearing the lock at ${path}; try again`);
    return false;
  }
  try {
    let pid: number | undefined;
    try {
      pid = holder(path);
    } catch (error) {
      // An unreadable lock cannot be judged stale, so the start stands down.
      console.error(`could not read the lock at ${path} (${(error as NodeJS.ErrnoException).code ?? "unknown"})`);
      return false;
    }
    // The no-hard-link fallback creates the lock empty and then writes the pid,
    // so an empty lock that is still fresh belongs to a start in progress.
    if (pid === undefined && isFreshEmptyLock(path)) {
      console.error(`another instance is starting with the lock at ${path}; try again`);
      return false;
    }
    if (!isStale(pid)) {
      console.error(`another instance is already running as pid ${pid}; stop it first`);
      return false;
    }
    return clearStale(candidate, path, pid);
  } finally {
    try {
      if (holder(takeover) === process.pid) unlinkSync(takeover);
    } catch {
      // The marker is already gone.
    }
  }
}

export function clearStale(candidate: string, path: string, pid: number | undefined): boolean {
  const aside = `${candidate}.stale`;
  try {
    renameSync(path, aside);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    console.error(`could not move the stale lock at ${path} (${code ?? "unknown"})`);
    return false;
  }

  let asidePid: number | undefined;
  try {
    asidePid = holder(aside);
  } catch (error) {
    console.error(`could not read the moved lock at ${aside} (${(error as NodeJS.ErrnoException).code ?? "unknown"})`);
    try {
      unlinkSync(aside);
    } catch {
      // The moved copy is gone already.
    }
    return false;
  }
  if (asidePid !== pid) {
    // The file changed since it was read, so a live claim now owns the path.
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
    console.error(`a live claim replaced the stale lock at ${path}; standing down`);
    return false;
  }
  try {
    unlinkSync(aside);
  } catch (error) {
    console.error(`could not remove the stale copy at ${aside} (${(error as NodeJS.ErrnoException).code ?? "unknown"})`);
    return false;
  }
  if (!createLock(candidate, path)) {
    console.error(`another instance claimed the lock at ${path} first`);
    return false;
  }
  return claim(path);
}
