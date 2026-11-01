import { DatabaseSync } from "node:sqlite";

const held = new Map<string, DatabaseSync>();
let shutdownHandlersRegistered = false;

export function acquireSingleInstanceLock(path = ".bot.lock"): boolean {
  if (held.has(path)) return true;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { timeout: 0 });
    // journal_mode=MEMORY keeps the rollback journal in memory, so no .bot.lock-journal sidecar is written.
    db.exec("PRAGMA journal_mode=MEMORY");
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
    db?.close();
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
