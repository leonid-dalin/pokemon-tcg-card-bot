import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIdentity, formatUptime, resolveIdentity } from "../src/version.js";

describe("buildIdentity", () => {
  it("trusts an explicit BUILD_SHA over everything else", () => {
    const identity = resolveIdentity({ BUILD_SHA: "abc1234", BUILD_DATE: "2026-10-29T05:00:00Z" });
    expect(identity).toMatchObject({ label: "abc1234", source: "env", built: "2026-10-29T05:00:00Z" });
  });

  it("falls back to the checkout when no env or bundle is present", () => {
    const identity = resolveIdentity({});
    expect(identity.source).not.toBe("env");
    expect(identity.label).toBeTruthy();
    expect(identity.packageVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("startup identity", () => {
  it("keeps reporting the identity captured at startup", () => {
    const first = buildIdentity();
    const second = buildIdentity();
    expect(second).toEqual(first);
    expect(second.label).toBe(first.label);
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

describe("image build identity", () => {
  it("reports the commit and date the image was built from", () => {
    // The Dockerfile sets both as environment defaults from build args.
    const identity = resolveIdentity({ BUILD_SHA: "c42292d", BUILD_DATE: "2026-10-31T13:34:00Z" });

    expect(identity.source).toBe("env");
    expect(identity.label).toBe("c42292d");
    expect(identity.built).toBe("2026-10-31T13:34:00Z");
  });

  it("keeps the package version available alongside the image sha", () => {
    const identity = resolveIdentity({ BUILD_SHA: "c42292d" });

    expect(identity.source).toBe("env");
    expect(identity.packageVersion).toBeDefined();
  });
});

describe("documented Compose build", () => {
  it("supplies both build arguments the Compose file declares", () => {
    const compose = readFileSync("compose.yaml", "utf8");
    expect(compose).toContain("BUILD_SHA:");
    expect(compose).toContain("BUILD_DATE:");

    // The documented command must hand both values to the build.
    const deployment = readFileSync("docs/deployment.md", "utf8");
    const command = deployment.split("\n").find((line) => line.includes("docker compose build"));
    expect(command).toBeDefined();
    expect(command).toContain("BUILD_SHA=");
    expect(command).toContain("BUILD_DATE=");
  });
});
