import { describe, expect, it } from "vitest";
import { PageStore, filterTokenFrom, listReply } from "../src/discord/pages.js";
import { handleFilterMenu } from "../src/discord/commands.js";

const context = (pages: PageStore) => ({ client: {} as never, attribution: "Source", energyEmoji: {}, pages });

const page = (pages: PageStore) =>
  pages.put({
    title: "Cards",
    items: [
      { cardId: "sv01-001", heading: "Bulbasaur", category: "Pokemon" },
      { cardId: "swsh11-164", heading: "Miss Fortune Sisters", category: "Trainer" },
      { cardId: "sv02-185", heading: "Iono", category: "Trainer" },
    ],
    perPage: 5,
    ownerId: "owner",
    footer: "Source",
    filterable: true,
  });

const press = (customId: string, values: string[], update: (payload: unknown) => void, reply: (payload: unknown) => void) =>
  ({ customId, values, user: { id: "owner" }, update: async (p: unknown) => update(p), reply: async (p: unknown) => reply(p) }) as never;

describe("filter custom id", () => {
  it("holds the page token, not the chosen category", () => {
    expect(filterTokenFrom("filter:abcdefgh")).toBe("abcdefgh");
    expect(filterTokenFrom("open:abcdefgh")).toBeUndefined();
  });
});

describe("pressing the filter menu", () => {
  it("narrows the list to the category that was chosen", async () => {
    const pages = new PageStore();
    const token = page(pages);
    const updates: { embeds: { data: { description?: string } }[]; components: unknown[] }[] = [];
    const interaction = press(`filter:${token}`, ["Trainer"], (p) => updates.push(p as never), () => {});
    await handleFilterMenu(context(pages), interaction);
    const description = updates[0]?.embeds[0]?.data?.description ?? "";
    expect(description).toContain("Miss Fortune Sisters");
    expect(description).toContain("Iono");
    expect(description).not.toContain("Bulbasaur");
  });

  it("shows every card when all is chosen", async () => {
    const pages = new PageStore();
    const token = page(pages);
    const updates: { embeds: { data: { description?: string } }[] }[] = [];
    const interaction = press(`filter:${token}`, ["all"], (p) => updates.push(p as never), () => {});
    await handleFilterMenu(context(pages), interaction);
    expect(updates[0]?.embeds[0]?.data?.description).toContain("Bulbasaur");
  });

  it("keeps the filter row after a press so the choice can change again", async () => {
    const pages = new PageStore();
    const token = page(pages);
    const updates: { components: { toJSON(): { components: { custom_id?: string }[] } }[] }[] = [];
    const interaction = press(`filter:${token}`, ["Trainer"], (p) => updates.push(p as never), () => {});
    await handleFilterMenu(context(pages), interaction);
    const ids = updates[0]!.components.map((row) => row.toJSON().components[0]?.custom_id);
    expect(ids).toContain(`filter:${token}`);
  });

  it("explains an expired list instead of blanking the message", async () => {
    const pages = new PageStore();
    const replies: { content?: string }[] = [];
    const interaction = press("filter:expired1", ["Trainer"], () => {}, (p) => replies.push(p as never));
    await handleFilterMenu(context(pages), interaction);
    expect(replies[0]?.content).toBe("This list has expired. Run the command again.");
  });

  it("never renders a blank page for a value it does not know", () => {
    const pages = new PageStore();
    const token = page(pages);
    const reply = listReply(pages.get(token)!, token, 0, "Nonexistent") as { embeds: { data: { description?: string } }[] };
    expect(reply.embeds[0]?.data?.description).toBeTruthy();
  });
});
