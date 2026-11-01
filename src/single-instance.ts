import { DatabaseSync } from "node:sqlite";

// The lock is a SQLite database, not a pid file. The kernel holds the file lock
// and drops it when the process dies, so there is no stale lock, no pid reuse to
// judge and no cleanup step. The handle is kept alive for the process life.
const held = new Map<string, DatabaseSync>();
let shutdownHandlersRegistered = false;

export function acquireSingleInstanceLock(path = ".bot.lock"): boolean {
  if (held.has(path)) return true;
  try {
    const db = new DatabaseSync(path, { timeout: 0 });
    db.exec("PRAGMA locking_mode=EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
    held.set(path, db);
    registerShutdownHandlers();
    return true;
  } catch (error) {
    const errcode = (error as { errcode?: number }).errcode;
    if (errcode === 5) {
      console.error(`another instance holds ${path}; stop it first`);
    } else if (errcode === 26) {
      console.error(`the file at ${path} is not a SQLite database; remove it and restart`);
    } else {
      console.error(`could not take the lock at ${path} (${(error as Error).message})`);
    }
    return false;
  }
}

function registerShutdownHandlers(): void {
  if (shutdownHandlersRegistered) return;
  shutdownHandlersRegistered = true;
  // index.ts registers no shutdown handler of its own, so exit on these signals.
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}
