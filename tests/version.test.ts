import { describe, expect, it } from "vitest";
import { buildIdentity, formatUptime } from "../src/version.js";

describe("buildIdentity", () => {
  it("trusts an explicit BUILD_SHA over everything else", () => {
    const identity = buildIdentity({ BUILD_SHA: "abc1234", BUILD_DATE: "2026-10-29T05:00:00Z" });
    expect(identity).toMatchObject({ label: "abc1234", source: "env", built: "2026-10-29T05:00:00Z" });
  });

  it("falls back to the checkout when no env or bundle is present", () => {
    const identity = buildIdentity({});
    expect(identity.source).not.toBe("env");
    expect(identity.label).toBeTruthy();
    expect(identity.packageVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("formatUptime", () => {
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  it("counts minutes under an hour", () => {
    expect(formatUptime(5 * minute)).toBe("5 minutes");
    expect(formatUptime(minute)).toBe("1 minute");
  });

  it("counts hours under a day", () => {
    expect(formatUptime(3 * hour)).toBe("3 hours");
  });

  it("counts days within the first week and keeps leftover hours", () => {
    expect(formatUptime(2 * day + 3 * hour)).toBe("2 days 3 hours");
    expect(formatUptime(day)).toBe("1 day");
  });

  it("drops the hour detail from a week onwards", () => {
    expect(formatUptime(8 * day + 5 * hour)).toBe("8 days");
    expect(formatUptime(7 * day + 1 * hour)).toBe("7 days");
  });
});
