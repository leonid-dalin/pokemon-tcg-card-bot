import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Card } from "../src/api/types.js";
import { isCardId } from "../src/lookup.js";
import { searchCardGroups, searchCardText, matchingDetail } from "../src/text-search.js";
import { PageStore, listReply, pageFilterFrom } from "../src/discord/pages.js";
import { searchReply } from "../src/discord/replies.js";

const evidence = JSON.parse(readFileSync("tests/fixtures/pr3-reaudit-evidence.json", "utf8"));

describe("R1 ordinary lists stay complete", () => {
  const savedCards = evidence.set.cards as { id: string }[];

  it("reaches every card of a 258-card set through pagination", () => {
    const page = {
      title: "Scarlet & Violet",
      items: savedCards.map((card) => ({ cardId: card.id, heading: card.id })),
      perPage: 15,
      ownerId: "owner",
      footer: "Source",
    };
    const pages = new PageStore();
    const token = pages.put(page);
    const collected: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      const reply = listReply(page, token, index);
      const menu = reply.components
        .flatMap((row) => row.toJSON().components)
        .find((component) => "options" in component) as { options?: { value: string }[] } | undefined;
      if (menu?.options) collected.push(...menu.options.map((option) => option.value));
      if (index >= 17) break;
    }
    expect(collected).toEqual(savedCards.map((card) => card.id));
  });

  it("keeps the search cap on every search view", () => {
    const group = (index: number, category: string) => ({
      representative: { id: `t-${String(index).padStart(4, "0")}`, name: `Card ${index}`, text: "does things", category },
      printings: 1,
    });
    const universe = [
      ...Array.from({ length: 260 }, (_, i) => group(i, "Pokemon")),
      ...Array.from({ length: 30 }, (_, i) => group(260 + i, "Trainer")),
    ];
    const pages = new PageStore();
    const reply = searchReply("does", universe, "Source", "owner", pages) as {
      components?: { toJSON: () => { components: { custom_id?: string } }[] }[];
    };
    const token = reply.components![1]!.toJSON().components[0]!.custom_id!.slice("filter:".length);
    const all = listReply(pages.get(token)!, token, 0);
    expect(all.embeds[0]!.data.footer?.text).toContain("the first 250 of 290");
  });
});

describe("R2 the source id contract", () => {
  it("recognises the recorded valid ids", () => {
    for (const card of evidence.cards as { id: string }[]) expect(isCardId(card.id), card.id).toBe(true);
    expect(isCardId("exu-%3F")).toBe(true);
  });

  it("still refuses hyphenated card names", () => {
    for (const name of ["Porygon-Z", "Ho-Oh", "Buddy-Buddy Poffin", "N", "Buddy-Buddy"]) {
      expect(isCardId(name), name).toBe(false);
    }
  });

  it("recognises every committed index id", () => {
    const index = JSON.parse(readFileSync("src/data/text-index.json", "utf8")) as { id: string }[];
    const rejected = index.map((entry) => entry.id).filter((id) => !isCardId(id));
    expect(rejected).toEqual([]);
  });

  it("resolves the recorded Greninja printing through its id", () => {
    const greninja = (evidence.cards as { id: string; name: string }[]).find((card) => card.id === "30th-c-009")!;
    expect(greninja.name).toBe("Greninja BREAK");
  });
});

describe("R4 markup never becomes wording", () => {
  const index = JSON.parse(readFileSync("src/data/text-index.json", "utf8")) as { id: string; name: string; text: string }[];
  const rawEntry = index.find((entry) => entry.id === "30th-c-008")!;
  expect(rawEntry.name).toBe("Pikachu & Zekrom GX");
  expect(rawEntry.text).toContain("<span");

  it("finds Lightning Energy quoted and unquoted in the raw entry", () => {
    const quoted = searchCardGroups('"lightning energy"');
    expect(quoted.some((group) => group.representative.id === "30th-c-008")).toBe(true);
    const plain = searchCardText("lightning energy");
    expect(plain.some((hit) => hit.id === "30th-c-008")).toBe(true);
  });

  it("keeps markup out of the shown excerpt", () => {
    const hits = searchCardText("lightning energy").filter((hit) => hit.id === "30th-c-008");
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.text).not.toMatch(/<[^>]+>/);
    }
  });

  it("does not match words that exist only inside attributes", () => {
    // "class" appears in the span attributes of the marked entries.
    const hits = searchCardText("class");
    expect(hits.some((hit) => hit.id === "30th-c-008")).toBe(false);
  });
});

describe("R3 quoted excerpt picks the phrase sentence", () => {
  it("shows the sentence that prints the phrase inside one attack", () => {
    const group = searchCardGroups('"during your next turn"').find((g) => g.representative.id === "me02.5-062");
    expect(group).toBeTruthy();
    const detail = matchingDetail(group!.representative, '"during your next turn"');
    expect(detail.startsWith("Attack · Pouncing Trap:")).toBe(true);
    const plain = detail.replaceAll("**", "").toLowerCase();
    expect(plain).toContain("during your next turn");
    expect(plain).toContain("100");
    expect(detail.length).toBeLessThanOrEqual(160);
  });

  it("keeps the Golisopod cross-attack fix", () => {
    const group = searchCardGroups('"during your next turn"').find((g) => g.representative.id === "me04-026");
    const detail = matchingDetail(group!.representative, '"during your next turn"');
    expect(detail.startsWith("Attack · Boundless Power:")).toBe(true);
  });
});

describe("R5 truncation notice describes the view", () => {
  const group = (index: number, category: string) => ({
    representative: { id: `t-${String(index).padStart(4, "0")}`, name: `Card ${index}`, text: "does things", category },
    printings: 1,
  });
  const universe = [
    ...Array.from({ length: 260 }, (_, i) => group(i, "Pokemon")),
    ...Array.from({ length: 73 }, (_, i) => group(260 + i, "Trainer")),
  ];

  it("claims truncation only where it happens", () => {
    const pages = new PageStore();
    const reply = searchReply("does", universe, "Source", "owner", pages) as {
      components?: { toJSON: () => { components: { custom_id?: string } }[] }[];
    };
    const token = reply.components![1]!.toJSON().components[0]!.custom_id!.slice("filter:".length);
    const all = listReply(pages.get(token)!, token, 0);
    expect(all.embeds[0]!.data.footer?.text).toBe("Source · the first 250 of 333");
    const trainer = listReply(pages.get(token)!, token, 0, "Trainer");
    expect(trainer.embeds[0]!.data.footer?.text).toBe("Source");
  });

  it("survives a page press and a return to all", () => {
    const pages = new PageStore();
    const reply = searchReply("does", universe, "Source", "owner", pages) as {
      components?: { toJSON: () => { components: { custom_id?: string } }[] }[];
    };
    const token = reply.components![1]!.toJSON().components[0]!.custom_id!.slice("filter:".length);
    const trainer = listReply(pages.get(token)!, token, 0, "Trainer");
    expect(trainer.embeds[0]!.data.footer?.text).toBe("Source");
    const pageId = trainer.components![0]!.toJSON().components[2]!.custom_id!;
    expect(pageFilterFrom(pageId)).toBe("Trainer");
    const back = listReply(pages.get(token)!, token, 0, "all");
    expect(back.embeds[0]!.data.footer?.text).toContain("the first 250 of 333");
  });
});

