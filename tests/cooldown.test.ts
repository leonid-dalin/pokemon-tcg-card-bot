import { describe, expect, it } from "vitest";
import { MentionBudget } from "../src/cooldown.js";

describe("MentionBudget", () => {
  it("allows a burst and then blocks", () => {
    const budget = new MentionBudget({ capacity: 3, refillSeconds: 5 });
    const now = 1_000_000;
    expect(budget.take("c:u", now).allowed).toBe(true);
    expect(budget.take("c:u", now).allowed).toBe(true);
    expect(budget.take("c:u", now).allowed).toBe(true);

    const blocked = budget.take("c:u", now);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSeconds).toBe(5);
  });

  it("refills one mention per interval", () => {
    const budget = new MentionBudget({ capacity: 2, refillSeconds: 5 });
    const start = 1_000_000;
    budget.take("c:u", start);
    budget.take("c:u", start);
    expect(budget.take("c:u", start).allowed).toBe(false);
    expect(budget.take("c:u", start + 5_000).allowed).toBe(true);
    expect(budget.take("c:u", start + 5_000).allowed).toBe(false);
  });

  it("never exceeds the capacity after a long idle", () => {
    const budget = new MentionBudget({ capacity: 2, refillSeconds: 5 });
    const start = 1_000_000;
    budget.take("c:u", start);
    budget.take("c:u", start);
    const later = start + 600_000;
    expect(budget.take("c:u", later).allowed).toBe(true);
    expect(budget.take("c:u", later).allowed).toBe(true);
    expect(budget.take("c:u", later).allowed).toBe(false);
  });

  it("keeps members independent", () => {
    const budget = new MentionBudget({ capacity: 1, refillSeconds: 30 });
    const now = 1_000_000;
    expect(budget.take("channel:a", now).allowed).toBe(true);
    expect(budget.take("channel:a", now).allowed).toBe(false);
    expect(budget.take("channel:b", now).allowed).toBe(true);
  });

  it("reports at least one second to wait", () => {
    const budget = new MentionBudget({ capacity: 1, refillSeconds: 5 });
    const now = 1_000_000;
    budget.take("c:u", now);
    const blocked = budget.take("c:u", now + 4_500);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
