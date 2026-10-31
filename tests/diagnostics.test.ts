import { describe, expect, it } from "vitest";
import { errorCategory } from "../src/diagnostics.js";

describe("errorCategory", () => {
  it("separates a locked database from a read-only one", () => {
    const locked = Object.assign(new Error("database is locked"), { code: "ERR_SQLITE_ERROR", errcode: 5 });
    const readonly = Object.assign(new Error("readonly database"), { code: "ERR_SQLITE_ERROR", errcode: 8 });
    expect(errorCategory(locked)).toBe("ERR_SQLITE_ERROR_5");
    expect(errorCategory(readonly)).toBe("ERR_SQLITE_ERROR_8");
  });

  it("keeps the plain driver code when no numeric code is present", () => {
    const bare = Object.assign(new Error("sqlite"), { code: "ERR_SQLITE_ERROR" });
    expect(errorCategory(bare)).toBe("ERR_SQLITE_ERROR");
  });

  it("reports an HTTP status before anything else", () => {
    expect(errorCategory({ status: 429, name: "DiscordAPIError" })).toBe("http-429");
    expect(errorCategory({ response: { status: 503 } })).toBe("http-503");
  });

  it("reports a filesystem or driver code", () => {
    const fsError = Object.assign(new Error("exists"), { code: "EEXIST" });
    const sqlite = Object.assign(new Error("locked"), { code: "ERR_SQLITE_ERROR" });
    expect(errorCategory(fsError)).toBe("EEXIST");
    expect(errorCategory(sqlite)).toBe("ERR_SQLITE_ERROR");
  });

  it("keeps a more specific API name over a non-code property", () => {
    const discord = Object.assign(new Error("body"), { name: "DiscordAPIError[50035]", code: 50035 });
    const undici = Object.assign(new Error("connect"), { name: "FetchError", code: "UND_ERR_CONNECT_TIMEOUT" });
    expect(errorCategory(discord)).toBe("DiscordAPIError[50035]");
    expect(errorCategory(undici)).toBe("FetchError");
  });

  it("falls back through name, cause and unknown", () => {
    expect(errorCategory(new TypeError("bad"))).toBe("TypeError");
    expect(errorCategory({ cause: Object.assign(new Error("inner"), { code: "EACCES" }) })).toBe("EACCES");
    expect(errorCategory(undefined)).toBe("unknown");
  });
});
