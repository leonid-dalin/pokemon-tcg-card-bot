import { describe, expect, it } from "vitest";
import { FAILURE, SETTINGS_FAILURE, failureMessageFor } from "../src/discord/interaction-failure.js";

const asCommand = (commandName: string) =>
  ({ isChatInputCommand: () => true, commandName }) as never;

const asComponent = (customId: string) =>
  ({ isChatInputCommand: () => false, customId }) as never;

describe("failureMessageFor", () => {
  it("keeps card wording for a card command", () => {
    expect(failureMessageFor(asCommand("card"))).toBe(FAILURE);
  });

  it("uses settings wording for the settings command", () => {
    expect(failureMessageFor(asCommand("settings"))).toBe(SETTINGS_FAILURE);
  });

  it("uses settings wording for a settings button", () => {
    expect(failureMessageFor(asComponent("st:cooldown-custom:sess"))).toBe(SETTINGS_FAILURE);
  });

  it("uses settings wording for a settings modal submit", () => {
    expect(failureMessageFor(asComponent("st:cooldown-modal:sess"))).toBe(SETTINGS_FAILURE);
  });

  it("uses settings wording for a settings select", () => {
    expect(failureMessageFor(asComponent("st:set:cooldown:sess"))).toBe(SETTINGS_FAILURE);
  });

  it("keeps card wording for a card button", () => {
    expect(failureMessageFor(asComponent("page:tok:1"))).toBe(FAILURE);
  });

  it("never names a card lookup on a settings surface", () => {
    for (const id of ["st:reset:sess", "st:ch:save:sess", "st:nav:sess"]) {
      expect(failureMessageFor(asComponent(id))).not.toContain("Card");
    }
  });
});
