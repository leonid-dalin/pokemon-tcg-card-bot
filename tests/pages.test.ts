import { describe, expect, it } from "vitest";
import { PageStore, listReply, pageIndexFrom, pageTokenFrom } from "../src/discord/pages.js";

const items = (count: number) => Array.from({ length: count }, (_, index) => ({
  cardId: `sv01-${String(index + 1).padStart(3, "0")}`,
  heading: `Card ${index + 1}`,
}));

const page = (count: number, overrides: Partial<{ ownerId: string; perPage: number }> = {}) => ({
  title: "Cards",
  items: items(count),
  perPage: overrides.perPage ?? 5,
  ownerId: overrides.ownerId ?? "owner",
  footer: "Source",
});

describe("listReply", () => {
  it("shows three pages and the final two items for twelve rows", () => {
    const reply = listReply(page(12), "abcdefgh", 2);
    expect(reply.embeds[0]?.data.description).toContain("Card 11");
    expect(reply.embeds[0]?.data.description).toContain("Card 12");
    expect(reply.embeds[0]?.data.description).not.toContain("Card 10");
    expect(reply.components).toHaveLength(2);
  });

  it("disables the boundary page buttons", () => {
    const first = listReply(page(12), "abcdefgh", 0).components[0]!.toJSON() as { components: { label: string; disabled?: boolean }[] };
    const last = listReply(page(12), "abcdefgh", 2).components[0]!.toJSON() as { components: { label: string; disabled?: boolean }[] };
    expect(first.components[0]).toMatchObject({ label: "◀", disabled: true });
    expect(last.components[2]).toMatchObject({ label: "▶", disabled: true });
  });

  it("puts only the current page card ids in its menu", () => {
    const reply = listReply(page(12), "abcdefgh", 1);
    const menu = reply.components[1]!.toJSON() as { components: { options: { value: string }[] }[] };
    expect(menu.components[0]?.options.map((option) => option.value)).toEqual(items(12).slice(5, 10).map((item) => item.cardId));
  });

  it("omits page navigation for a single page", () => {
    expect(listReply(page(4), "abcdefgh", 0).components).toHaveLength(1);
  });

  it("uses the expiry message for an unknown page token", () => {
    expect(pageTokenFrom("page:abcdefgh:2")).toBe("abcdefgh");
    expect(pageIndexFrom("page:abcdefgh:2")).toBe(2);
    expect(pageTokenFrom("open:abcdefgh")).toBe("abcdefgh");
  });
});

describe("PageStore", () => {
  it("evicts the oldest entry when full", () => {
    let now = 0;
    const store = new PageStore({ maxEntries: 2, ttlMs: 1000, now: () => now });
    const first = store.put(page(1));
    const second = store.put(page(1));
    const third = store.put(page(1));
    expect(store.get(first)).toBeUndefined();
    expect(store.get(second)).toBeDefined();
    expect(store.get(third)).toBeDefined();
    now = 1001;
  });

  it("expires entries using the injected clock", () => {
    let now = 0;
    const store = new PageStore({ ttlMs: 100, now: () => now });
    const token = store.put(page(1));
    now = 100;
    expect(store.get(token)).toBeUndefined();
  });
});