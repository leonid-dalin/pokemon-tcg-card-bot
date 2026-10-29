import { describe, expect, it } from "vitest";
import { MentionBudget } from "../src/cooldown.js";
import { busyMessage } from "../src/discord/interaction-failure.js";

describe("member lookup budget", () => {
  it("keeps one guild's spending away from another", () => {
    const budget = new MentionBudget({ capacity: 1, refillSeconds: 60 });
    expect(budget.take("guild-a:member-1").allowed).toBe(true);
    expect(budget.take("guild-a:member-1").allowed).toBe(false);
    expect(budget.take("guild-b:member-1").allowed).toBe(true);
  });

  it("keeps two members in one guild separate", () => {
    const budget = new MentionBudget({ capacity: 1, refillSeconds: 60 });
    expect(budget.take("guild-a:member-1").allowed).toBe(true);
    expect(budget.take("guild-a:member-2").allowed).toBe(true);
  });

  it("holds storage bounded when many members look up cards", () => {
    const budget = new MentionBudget({ capacity: 2, refillSeconds: 60, maxKeys: 50 });
    for (let index = 0; index < 500; index += 1) budget.take(`guild-a:member-${index}`);
    expect(budget.size).toBeLessThanOrEqual(50);
  });

  it("reports a wait a member can act on", () => {
    expect(busyMessage(1)).toBe("The card service is busy. Try again in 1 second.");
    expect(busyMessage(4)).toBe("The card service is busy. Try again in 4 seconds.");
  });
});
