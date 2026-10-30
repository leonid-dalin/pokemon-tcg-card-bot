import { describe, expect, it } from "vitest";
import { settingsAnnouncementChunks } from "../src/discord/announcement.js";

const LIMIT = 4096;

describe("settings announcement chunks", () => {
  it("keeps a short change in one description", () => {
    const chunks = settingsAnnouncementChunks(["Message replies: On -> Off"]);
    expect(chunks).toEqual(["Message replies: On -> Off"]);
  });

  it("splits a long channel list so every description fits", () => {
    // 300 channel mentions push well past the 4,096-character description limit.
    const added = `Added: ${Array.from({ length: 300 }, (_, index) => `<#${100000000000000000 + index}>`).join(", ")}`;
    const chunks = settingsAnnouncementChunks(["Automatic-reply channels: Everywhere -> 300 selected", added, "Removed: <#1>"]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(LIMIT);
    expect(chunks.join("\n")).toContain("<#1>");
    expect(chunks.join("\n")).toContain("Automatic-reply channels");
  });

  it("splits a single over-long line rather than dropping it", () => {
    const line = `<#${"9".repeat(9000)}>`;
    const chunks = settingsAnnouncementChunks([line]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(LIMIT);
    expect(chunks.join("")).toBe(line);
  });

  it("returns one empty description when there is nothing to report", () => {
    expect(settingsAnnouncementChunks([])).toEqual([""]);
  });
});
