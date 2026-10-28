import { describe, expect, it } from "vitest";
import { detailsRows } from "../src/discord/printing-buttons.js";

const lookup = (id: string, name = "Dragapult ex") => ({ card: { id, name } });

const ids = (lookups: { card: { id: string; name: string } }[]) => {
  const row = detailsRows(lookups)[0];
  if (!row) return [];
  return (row.toJSON() as { components: { custom_id: string }[] }).components.map((component) => component.custom_id);
};

describe("detailsRows", () => {
  it("gives each card one button when the same card is named twice", () => {
    expect(ids([lookup("sv08.5-073"), lookup("sv08.5-073")])).toEqual(["details:sv08.5-073"]);
  });

  it("keeps distinct cards apart", () => {
    expect(ids([lookup("sv08.5-073"), lookup("sv06-130")])).toEqual(["details:sv08.5-073", "details:sv06-130"]);
  });

  it("applies the cap after de-duplicating", () => {
    // Six entries, one duplicated: five distinct cards survive the limit of five.
    const lookups = ["a-1", "a-1", "b-2", "c-3", "d-4", "e-5"].map((id) => lookup(id));
    expect(ids(lookups)).toHaveLength(5);
  });

  it("returns nothing for an empty reply", () => {
    expect(detailsRows([])).toEqual([]);
  });
});
