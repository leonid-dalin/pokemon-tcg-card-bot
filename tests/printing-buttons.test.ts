import { describe, expect, it } from "vitest";
import { PRINTING_PREFIX, mentionRows, printingIdFrom, printingRows } from "../src/discord/printing-buttons.js";

const card = (id: string) => ({ id, name: "Dragapult ex" });

describe("printingRows", () => {
  it("returns nothing when there is one printing", () => {
    expect(printingRows([])).toEqual([]);
  });

  it("builds one row carrying the card ids", () => {
    const rows = printingRows([card("sv06-130"), card("me02.5-160")]);
    expect(rows).toHaveLength(1);
    const json = rows[0]?.toJSON() as { components: { custom_id: string; label: string }[] };
    expect(json.components.map((component) => component.custom_id)).toEqual([
      `${PRINTING_PREFIX}sv06-130`,
      `${PRINTING_PREFIX}me02.5-160`,
    ]);
    expect(json.components[0]?.label).toBe("TWM 130");
    expect(json.components[0]?.custom_id).toContain("sv06-130");
  });

  it("never repeats a custom id when a printing is listed twice", () => {
    const rows = printingRows(["b4-212", "b4-212", "a1-128", "pa-010", "pa-010"].map(card));
    const json = rows[0]?.toJSON() as { components: { custom_id: string }[] };
    expect(json.components.map((component) => component.custom_id)).toEqual([
      `${PRINTING_PREFIX}b4-212`,
      `${PRINTING_PREFIX}a1-128`,
      `${PRINTING_PREFIX}pa-010`,
    ]);
  });

  it("caps the row at five buttons, which is the Discord limit", () => {
    const rows = printingRows(["a-1", "a-2", "a-3", "a-4", "a-5", "a-6", "a-7"].map(card));
    const json = rows[0]?.toJSON() as { components: unknown[] };
    expect(json.components).toHaveLength(5);
  });
});

describe("printingIdFrom", () => {
  it("reads the card id back", () => {
    expect(printingIdFrom(`${PRINTING_PREFIX}sv06-130`)).toBe("sv06-130");
  });

  it("ignores other components", () => {
    expect(printingIdFrom("other:thing")).toBeUndefined();
    expect(printingIdFrom(`${PRINTING_PREFIX}   `)).toBeUndefined();
  });
});

describe("mentionRows", () => {
  it("offers printings under a single card", () => {
    expect(mentionRows([{ alternates: [card("sv06-130")] }])).toHaveLength(1);
  });

  it("offers none when the reply shows several cards", () => {
    const lookups = [{ alternates: [card("sv06-130")] }, { alternates: [card("sv03-125")] }];
    expect(mentionRows(lookups)).toEqual([]);
  });
});
