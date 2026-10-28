export function errorCategory(error: unknown): string {
  if (error && typeof error === "object") {
    const source = error as { status?: unknown; response?: { status?: unknown }; name?: unknown; cause?: unknown };
    const status = typeof source.status === "number" ? source.status : source.response?.status;
    if (typeof status === "number") return `http-${status}`;
    if (typeof source.name === "string" && source.name) return source.name;
    if (source.cause) return errorCategory(source.cause);
  }
  return "unknown";
}
