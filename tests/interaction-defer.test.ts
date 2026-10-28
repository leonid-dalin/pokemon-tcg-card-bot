import { describe, expect, it } from "vitest";
import { MessageFlags } from "discord.js";
import { PageStore } from "../src/discord/pages.js";
import { handleDetailsButton, handleOpenCardMenu } from "../src/discord/commands.js";
import { mentionReply } from "../src/discord/replies.js";
import type { TextGroup } from "../src/text-search.js";

const context = (pages = new PageStore()) => ({
  client: {} as never,
  attribution: "Card data from TCGdex",
  energyEmoji: {},
  pages,
});

describe("details button", () => {
  it("defers ephemerally before the lookup", async () => {
    const calls: string[] = [];
    const interaction = {
      customId: "details:sv08.5-073",
      user: { id: "1" },
      deferReply: async (payload: { flags: number }) => calls.push(`defer:${payload.flags}`),
      editReply: async () => calls.push("edit"),
      reply: async () => calls.push("reply"),
    };
    // An empty client makes the lookup fail; the defer must still come first.
    await handleDetailsButton(context(), interaction as never).catch(() => {});
    expect(calls[0]).toBe(`defer:${MessageFlags.Ephemeral}`);
    expect(calls).not.toContain("reply");
  });
});

describe("open a card menu", () => {
  it("answers the expiry before deferring, and defers publicly", async () => {
    const calls: string[] = [];
    const interaction = {
      customId: "open:expired1",
      user: { id: "1" },
      values: ["sv08.5-073"],
      deferReply: async () => calls.push("defer"),
      reply: async () => calls.push("reply"),
      editReply: async () => calls.push("edit"),
    };
    await handleOpenCardMenu(context(), interaction as never);
    expect(calls).toEqual(["reply"]);
  });

  it("defers without the ephemeral flag when the page is live", async () => {
    const pages = new PageStore();
    const token = pages.put({ title: "Cards", items: [], perPage: 5, ownerId: "1", footer: "Source" });
    const calls: string[] = [];
    const interaction = {
      customId: `open:${token}`,
      user: { id: "1" },
      values: ["sv08.5-073"],
      deferReply: async (payload?: { flags?: number }) => calls.push(`defer:${payload?.flags ?? "public"}`),
      reply: async () => calls.push("reply"),
      editReply: async () => calls.push("edit"),
    };
    await handleOpenCardMenu(context(pages), interaction as never).catch(() => {});
    expect(calls[0]).toBe("defer:public");
    expect(calls).not.toContain("reply");
  });
});

describe("two misses in one reply", () => {
  const miss = (raw: string) => ({ raw, closest: [{ id: `sv01-00${raw.length}`, name: raw }] });

  it("gives each menu its own custom id", () => {
    const reply = mentionReply([], [miss("Foo"), miss("Barr")]);
    const ids = (reply.components ?? []).map((row) => (row.toJSON() as { components: { custom_id?: string }[] }).components[0]?.custom_id);
    expect(ids).toEqual(["open:miss0", "open:miss1"]);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("long search title", () => {
  it("caps the query in the title and keeps the count", async () => {
    const { searchReply } = await import("../src/discord/replies.js");
    const groups: TextGroup[] = [{ representative: { id: "sv01-001", name: "Card", text: "t" }, printings: 1 }];
    const reply = searchReply("a".repeat(300), groups, "Source", "1", new PageStore());
    const title = (reply.embeds as { data: { title?: string } }[])[0]?.data.title ?? "";
    expect(title.startsWith("1 cards mention \"")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(256);
    expect(title.endsWith("...") || title.endsWith("\"") || title.length < 120).toBe(true);
  });
});
