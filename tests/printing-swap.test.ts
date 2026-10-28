import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Card } from "../src/api/types.js";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { PageStore } from "../src/discord/pages.js";
import { handlePrintingButton } from "../src/discord/commands.js";
import { mentionReply } from "../src/discord/replies.js";

const evidence = JSON.parse(readFileSync("tests/fixtures/pr3-evidence.json", "utf8"));

describe("printing swap clears removed miss context", () => {
  it("replaces a mixed reply and explicitly clears the old prompt", async () => {
    const card = evidence.dragapultCard as Card;
    const alternate = { id: "sv06-130", name: card.name };
    const original = mentionReply(
      [{ card, alternates: [alternate], matchingPrintings: [alternate] }],
      [{ raw: "Dragapult zzz", closest: [alternate] }],
      "owner",
    );
    expect(JSON.stringify(original)).toContain("Pick the closest below.");

    const client = {
      getCard: async (id: string) => ({ ...card, id }),
      searchByName: async () => [card, alternate],
    } as unknown as TcgdexClient;
    const edit = vi.fn(async () => ({}));
    await handlePrintingButton(
      { client, attribution: "Card data from TCGdex", energyEmoji: {}, pages: new PageStore() },
      {
        customId: "printing:sv06-130:owner",
        user: { id: "owner" },
        deferUpdate: async () => {},
        editReply: edit as never,
      } as never,
    );
    const payload = edit.mock.calls[0]![0]! as Record<string, unknown>;
    expect(Object.hasOwn(payload, "content")).toBe(true);
    expect(payload.content === null || payload.content === "").toBe(true);
  });

  it("still refuses a press from someone else", async () => {
    const reply = vi.fn(async () => ({}));
    await handlePrintingButton(
      { client: {} as TcgdexClient, attribution: "x", energyEmoji: {}, pages: new PageStore() },
      {
        customId: "printing:sv06-130:owner",
        user: { id: "someone-else" },
        reply: reply as never,
      } as never,
    );
    expect(reply.mock.calls[0]![0]).toMatchObject({ flags: expect.anything() });
  });
});
