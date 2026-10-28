import { describe, expect, it } from "vitest";
import { cardmarketUrl, limitlessUrl } from "../src/links.js";
import { cardmarketRow, detailsRow } from "../src/discord/printing-buttons.js";

const buttons = (cardId: string) => {
  const row = detailsRow(cardId, "Details")[0]!;
  return (row.toJSON() as { components: { label?: string; url?: string; custom_id?: string }[] }).components;
};

describe("limitlessUrl", () => {
  it("builds the printed code and the bare number", () => {
    expect(limitlessUrl("sv01-181")).toBe("https://limitlesstcg.com/cards/SVI/181");
    expect(limitlessUrl("swsh1-181")).toBe("https://limitlesstcg.com/cards/SSH/181");
  });

  it("maps the newest sets by their set-index code", () => {
    expect(limitlessUrl("30th-006")).toBe("https://limitlesstcg.com/cards/30C/6");
    expect(limitlessUrl("me04-048")).toBe("https://limitlesstcg.com/cards/CRI/48");
  });

  it("uses the pocket database for a pocket set", () => {
    expect(limitlessUrl("A1-001")).toBe("https://pocket.limitlesstcg.com/cards/A1/1");
  });

  it("strips the leading zeros a deck would not write", () => {
    expect(limitlessUrl("sv03.5-040")).toBe("https://limitlesstcg.com/cards/MEW/40");
  });

  it("keeps a printed letter in the number", () => {
    expect(limitlessUrl("swsh12.5gg-GG65")).toBe("https://limitlesstcg.com/cards/CRZ/GG65");
  });

  it("gives no link for a set the index does not know", () => {
    expect(limitlessUrl("zzz9-999")).toBeUndefined();
  });

  it("resolves Celebrations by its real index id", () => {
    expect(limitlessUrl("cel25-006")).toBe("https://limitlesstcg.com/cards/CEL/6");
  });
});

describe("cardmarketUrl", () => {
  it("uses the Search format the site's own UI builds", () => {
    expect(cardmarketUrl("sv01-181", "Nest Ball")).toBe(
      "https://www.cardmarket.com/en/Pokemon/Products/Search?category=-1&searchString=Nest+Ball+SVI&category=-1&searchMode=v2",
    );
  });

  it("gives no link for a pocket card, which Cardmarket does not list", () => {
    expect(cardmarketUrl("A1-001", "Bulbasaur")).toBeUndefined();
  });

  it("gives no link for a set the index does not know", () => {
    expect(cardmarketUrl("zzz9-999", "Nest Ball")).toBeUndefined();
  });
});

describe("link buttons on the details row", () => {
  it("carries Details and Limitless, with Cardmarket on the details embed instead", () => {
    const row = buttons("sv01-181");
    expect(row.map((b) => b.label)).toEqual(["Details", "Limitless"]);
    expect(row[1]!.url).toContain("limitlesstcg.com/cards/SVI/181");
  });

  it("gives a Cardmarket row for the details embed, with the site's Search format", () => {
    const row = cardmarketRow("sv01-181", "Nest Ball")!.toJSON() as { components: { label?: string; url?: string }[] };
    expect(row.components[0]!.label).toBe("Cardmarket");
    expect(row.components[0]!.url).toContain("Products/Search?category=-1&searchString=Nest+Ball+SVI");
  });

  it("gives no Cardmarket row for a pocket card", () => {
    expect(cardmarketRow("A1-001", "Bulbasaur")).toBeUndefined();
  });

  it("leaves the Details button alone when no links exist", () => {
    const row = buttons("zzz9-999");
    expect(row.map((b) => b.label)).toEqual(["Details"]);
    expect(row[0]!.custom_id).toBe("details:zzz9-999");
  });
});
