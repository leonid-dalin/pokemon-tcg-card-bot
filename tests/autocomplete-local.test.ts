import { describe, expect, it, vi } from "vitest";
import { handleAutocomplete } from "../src/discord/commands.js";
import { isPocketCardId } from "../src/prizes.js";

type Choice = { name: string; value: string };

function context(search: () => Promise<unknown[]>) {
  return {
    client: { searchByName: search },
    attribution: "x",
    energyEmoji: {},
    settings: { get: () => ({ cardGames: "pocket", defaultCardGame: "pocket" }) },
  };
}

async function choices(client: ReturnType<typeof context>, value: string): Promise<Choice[]> {
  const responses: Choice[][] = [];
  await handleAutocomplete(client as never, {
    guildId: "guild-a",
    user: { id: "member-1" },
    options: { getFocused: () => ({ name: "name", value }) },
    respond: async (result: Choice[]) => void responses.push(result),
  } as never);
  return responses[0] ?? [];
}

describe("Pocket autocomplete from the bundled catalogue", () => {
  it("offers a package-only card and no physical candidate", async () => {
    const result = await choices(context(async () => []), "Mega Mewtwo Y ex");
    expect(result.map((choice) => choice.value)).toContain("pc-002");
    expect(result.every((choice) => isPocketCardId(choice.value))).toBe(true);
  });

  it("keeps local candidates when upstream outlasts the deadline", async () => {
    vi.useFakeTimers();
    try {
      const pending = choices(context(() => new Promise<never>(() => undefined)), "Genome Converter Y");
      await vi.advanceTimersByTimeAsync(2100);
      const result = await pending;
      expect(result.map((choice) => choice.value)).toContain("pc-009");
    } finally {
      vi.useRealTimers();
    }
  });

  it("dedupes aliases of the same Pocket id before the option cap", async () => {
    const result = await choices(
      context(async () => [{ id: "PC-002", name: "Mega Mewtwo Y ex", localId: "002" }]),
      "Mega Mewtwo Y ex",
    );
    expect(result.filter((choice) => choice.value.toLowerCase() === "pc-002")).toHaveLength(1);
    expect(result.length).toBeLessThanOrEqual(25);
    expect(result.every((choice) => choice.name.length <= 100)).toBe(true);
  });
});
