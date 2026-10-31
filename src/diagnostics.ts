export function errorCategory(error: unknown): string {
  if (error && typeof error === "object") {
    const source = error as { status?: unknown; response?: { status?: unknown }; name?: unknown; cause?: unknown; code?: unknown; errcode?: unknown };
    const status = typeof source.status === "number" ? source.status : source.response?.status;
    if (typeof status === "number") return `http-${status}`;
    // A locked database and a read-only one both report ERR_SQLITE_ERROR, so keep
    // the driver's numeric code, which is what separates them for an operator.
    if (source.code === "ERR_SQLITE_ERROR" && typeof source.errcode === "number") {
      return `ERR_SQLITE_ERROR_${source.errcode}`;
    }
    // Filesystem and driver errors carry the actionable distinction in `code`
    // (EEXIST, EACCES, ERR_SQLITE_ERROR); an API's error name is more specific.
    if (typeof source.code === "string" && /^E[A-Z_]+$/.test(source.code)) return source.code;
    if (typeof source.name === "string" && source.name) return source.name;
    if (source.cause) return errorCategory(source.cause);
  }
  return "unknown";
}
