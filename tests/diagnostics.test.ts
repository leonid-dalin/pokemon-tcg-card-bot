import { describe, expect, it } from "vitest";
import { errorCategory } from "../src/diagnostics.js";

describe("errorCategory", () => {
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
