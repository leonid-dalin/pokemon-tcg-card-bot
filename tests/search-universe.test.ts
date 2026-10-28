import { describe, expect, it } from "vitest";
import { PageStore, filterTokenFrom, listReply } from "../src/discord/pages.js";
import { searchReply } from "../src/discord/replies.js";

const group = (index: number, name: string, category: string, text = "does its thing") => ({
  representative: { id: `test-${String(index).padStart(4, "0")}`, name, text, category },
  printings: 1,
});

/** 260 Pokemon first, then the late categories the global cap would bury. */
const universe = [
  ...Array.from({ length: 260 }, (_, i) => group(i, `Battler ${i + 1}`, "Pokemon")),
  ...Array.from({ length: 30 }, (_, i) => group(260 + i, `Tool ${i + 1}`, "Trainer")),
  ...Array.from({ length: 5 }, (_, i) => group(290 + i, `Boost ${i + 1}`, "Energy")),
];

const menuOptions = (reply: { components?: { toJSON: () => { components: { custom_id?: string; options?: { value: string; label: string }[] } }[] }[] }) =>
  reply.components
    ?.flatMap((row) => row.toJSON().components)
    .find((component) => component.custom_id?.startsWith("filter:"))?.options ?? [];

describe("search category universe", () => {
  it("offers the late categories with their full-universe counts", () => {
    const reply = searchReply("does", universe, "Source", "owner", new PageStore());
    const options = menuOptions(reply as never);
    expect(options.map((option) => option.value)).toContain("Trainer");
    expect(options.map((option) => option.value)).toContain("Energy");
    expect(options.find((option) => option.value === "Trainer")?.label).toBe("Trainers (30)");
    expect(options.find((option) => option.value === "Energy")?.label).toBe("Energy (5)");
  });

  it("keeps the all-view cap and the truncation notice", () => {
    const reply = searchReply("does", universe, "Source", "owner", new PageStore());
    const embed = (reply as { embeds: { data: { footer?: { text: string } } }[] }).embeds[0]!;
    expect(embed.data.footer?.text).toContain("the first 250 of 295");
  });

  it("shows the full late category and pages inside it", () => {
    const pages = new PageStore();
    const reply = searchReply("does", universe, "Source", "owner", pages) as {
      components?: { toJSON: () => { components: { custom_id?: string } }[] }[];
    };
    const token = filterTokenFrom(reply.components![1]!.toJSON().components[0]!.custom_id!);
    expect(token).toBeTruthy();
    const filtered = listReply(pages.get(token!)!, token!, 0, "Trainer");
    const embed = (filtered as { embeds: { data: { title?: string; description?: string } }[] }).embeds[0]!.data;
    const items = embed.description!.split("\n").filter((line) => line.startsWith("**") && line.includes(" · "));
    expect(items).toHaveLength(5);
    expect(items[0]).toContain("Tool 1");
    const rows = (filtered as { components?: { toJSON: () => { components: { custom_id?: string; label?: string } } }[] }).components!;
    expect(rows.some((row) => row.toJSON().components.some((component) => component.custom_id?.startsWith("page:") && component.label === "▶"))).toBe(true);
  });

  it("stores a bounded union, not every match", () => {
    const pages = new PageStore();
    searchReply("does", universe, "Source", "owner", pages);
    const stored = [...(pages as unknown as { pages: Map<string, { page: { items: unknown[] } }> }).pages.values()];
    // 250 overall + 30 Trainer + 5 Energy, deduplicated by representative.
    expect(stored[0]!.page.items).toHaveLength(250 + 30 + 5);
  });
});
