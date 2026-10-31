export function errorCategory(error: unknown): string {
  if (error && typeof error === "object") {
    const source = error as { status?: unknown; response?: { status?: unknown }; name?: unknown; cause?: unknown; code?: unknown };
    const status = typeof source.status === "number" ? source.status : source.response?.status;
    if (typeof status === "number") return `http-${status}`;
    // Filesystem and driver errors carry the actionable distinction in `code`
    // (EEXIST, EACCES, ERR_SQLITE_ERROR); an API's error name is more specific.
    if (typeof source.code === "string" && /^E[A-Z_]+$/.test(source.code)) return source.code;
    if (typeof source.name === "string" && source.name) return source.name;
    if (source.cause) return errorCategory(source.cause);
  }
  return "unknown";
}
