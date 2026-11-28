import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { lookupCard } from "../src/lookup.js";
import { printingsOf } from "../src/printings.js";
import type { TcgdexClient } from "../src/api/tcgdex.js";
import type { Card, CardSummary } from "../src/api/types.js";
import { handleAutocomplete, handleCardCommand, handlePrintingsCommand } from "../src/discord/commands.js";
import { createMessageHandler } from "../src/discord/messages.js";
import { PageStore } from "../src/discord/pages.js";
import { cardReply, searchReply } from "../src/discord/replies.js";
import { SettingsStore, type CardGameDefault, type CardGameScope } from "../src/settings-store.js";
import { extractMentions } from "../src/mentions.js";
import { isPocketCardId } from "../src/prizes.js";
import { normaliseName } from "../src/resolve.js";

const B = new URL("./", import.meta.url);
const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, B), "utf8"));
const corpus = read("selection-corpus.json") as {
  settings: { id: string; allowed: CardGameScope | null; default: CardGameDefault | null }[];
  cases: {
    id: string;
    kind: string;
    query: string;
    upstream?: string;
    physicalId?: string;
    pocketId?: string;
    setHint?: string;
    setId?: string;
    setAbility?: string;
    mustNotReturn?: string;
    mustNotReturnName?: string;
    expectNoMatch?: boolean;
    expectedGame: Record<string, string>;
  }[];
};
const textIndex = JSON.parse(readFileSync(new URL("../src/data/text-index.json", B), "utf8")) as { id: string; name: string }[];
const baseCard = read("selection-card-me03-030.json") as Card;
const lorCard = read("selection-card-swsh11-062.json") as Card;
const captured = new Map<string, Card>([[lorCard.id, lorCard], [baseCard.id, baseCard]]);

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "selection-corpus-")));
afterAll(() => {
  const target = process.env.CORPUS_EVIDENCE_PATH ?? join(scratch, "selection-corpus-results.json");
  const payload = {
    summary: {
      cases: corpus.cases.length,
      settings: corpus.settings.length,
      requests: corpus.cases.length * corpus.settings.length,
      recorded: evidence.length,
    },
    requests: evidence,
  };
  writeFileSync(target, JSON.stringify(payload, null, 2));
  console.log(`selection corpus evidence: ${target} (${evidence.length} request rows)`);
  rmSync(scratch, { recursive: true, force: true });
});

function clientFor(entry: (typeof corpus.cases)[number], reversed = false): TcgdexClient {
  const wanted = normaliseName(extractMentions(`[[${entry.query}]]`)[0]?.name ?? entry.query);
  const indexRows: CardSummary[] = textIndex
    .filter((card) => normaliseName(card.name) === wanted)
    .map((card) => ({ id: card.id, name: card.name, localId: card.id.slice(card.id.lastIndexOf("-") + 1) }));
  const capturedRows = entry.upstream ? (read(entry.upstream) as CardSummary[]) : [];
  const merged = [...indexRows, ...capturedRows].filter(
    (card, index, all) => all.findIndex((row) => row.id.toLowerCase() === card.id.toLowerCase()) === index,
  );
  const summaries = reversed ? [...merged].reverse() : merged;
  return {
    searchByName: async () => summaries,
    getCard: async (id: string) => captured.get(id) ?? { ...baseCard, id, name: summaries.find((row) => row.id.toLowerCase() === id.toLowerCase())?.name ?? entry.query },
  } as unknown as TcgdexClient;
}

function preference(setting: (typeof corpus.settings)[number]) {
  return setting.allowed ? { allowed: setting.allowed, default: setting.default! } : undefined;
}

function store() {
  return new SettingsStore(join(scratch, "settings.db"), { messageReplies: true, decklistReplies: false, cooldownSeconds: 0 });
}

type Result = {
  id: string | null;
  game: "ptcg" | "pocket" | "none";
  name: string | null;
  attribution: string | null;
  setReachable: boolean;
  fallback: string | null;
};

async function runLookup(entry: (typeof corpus.cases)[number], setting: (typeof corpus.settings)[number], reversed = false): Promise<Result> {
  const mention = extractMentions(`[[${entry.query}]]`)[0] ?? { name: entry.query };
  const gamePreference = preference(setting);
  const client = clientFor(entry, reversed);
  const lookup = await lookupCard(client, mention.name, mention.setHint, gamePreference ? { gamePreference } : {});
  const scope = gamePreference
    ? gamePreference.allowed === "both" ? gamePreference.default : gamePreference.allowed
    : "both";
  const allPrintings = await printingsOf(client, mention.name, scope);
  const ids = [lookup?.card.id, ...(lookup?.alternates.map((card) => card.id) ?? []), ...allPrintings.map((card) => card.id)];
  return {
    id: lookup?.card.id ?? null,
    game: lookup ? (isPocketCardId(lookup.card.id) ? "pocket" : "ptcg") : "none",
    name: lookup?.card.name ?? null,
    attribution: lookup?.attribution ?? null,
    setReachable: entry.setId ? ids.some((id) => id?.toLowerCase() === entry.setId!.toLowerCase()) : false,
    fallback: lookup ? null : "no match",
  };
}

function payloadIds(payload: Record<string, unknown>): string[] {
  return (payload.components as { toJSON: () => { components: { custom_id?: string }[] } }[] ?? [])
    .flatMap((row) => row.toJSON().components.map((component) => component.custom_id ?? ""))
    .flatMap((id) => [id.startsWith("allprint:") ? id.split(":")[1] : undefined, id.startsWith("printing:") ? id.split(":")[1] : undefined])
    .filter((value): value is string => Boolean(value));
}

function assertDelivered(entry: (typeof corpus.cases)[number], setting: (typeof corpus.settings)[number], payload: Record<string, unknown>) {
  const delivered = payloadIds(payload);
  expect(delivered.length).toBeGreaterThan(0);
  const expected = entry.expectedGame[setting.id];
  if (expected === "none") return;
  const pocket = delivered.some((id) => isPocketCardId(id));
  if (expected === "ptcg") expect(pocket).toBe(false);
  if (expected === "pocket") expect(delivered.every((id) => isPocketCardId(id))).toBe(true);
}

async function runMessage(entry: (typeof corpus.cases)[number], setting: (typeof corpus.settings)[number], settingsStore: SettingsStore) {
  const replies: Record<string, unknown>[] = [];
  const settings = { get: (guildId: string) => settingsStore.get(guildId) };
  const handler = createMessageHandler({
    api: clientFor(entry),
    config: { mentionEnabled: true, decklistEnabled: false, mentionCooldownSeconds: 0, attribution: "Card data from TCGdex", energyEmoji: {} },
    pages: new PageStore(),
    settings,
    selfId: () => "bot",
  });
  await handler({
    id: "m1", author: { id: "member", bot: false, username: "member" }, webhookId: null, system: false,
    content: `[[${entry.query}]]`, attachments: { size: 0 }, embeds: [], stickers: { size: 0 },
    channelId: "c1", guildId: setting.allowed ? "g1" : null, member: undefined, channel: {},
    reply: async (payload: Record<string, unknown>) => { replies.push(payload); return {}; },
  } as never);
  return replies;
}

async function runSlash(entry: (typeof corpus.cases)[number], setting: (typeof corpus.settings)[number], settingsStore: SettingsStore) {
  const payloads: Record<string, unknown>[] = [];
  const context = {
    client: clientFor(entry), attribution: "Card data from TCGdex", energyEmoji: {}, pages: new PageStore(),
    settings: { get: (guildId: string) => settingsStore.get(guildId), resolveCurrency: () => "EUR" as const },
  };
  const mention = extractMentions(`[[${entry.query}]]`)[0] ?? { name: entry.query };
  await handleCardCommand(context as never, {
    guildId: setting.allowed ? "g1" : null, user: { id: "member" },
    options: { getString: (name: string) => name === "name" ? mention.name : (mention.setHint ?? null), getBoolean: () => null },
    deferReply: async () => {}, editReply: async (payload: Record<string, unknown>) => void payloads.push(payload),
  } as never);
  return payloads;
}

async function runAutocomplete(entry: (typeof corpus.cases)[number], setting: (typeof corpus.settings)[number], settingsStore: SettingsStore) {
  const responses: { name: string; value: string }[][] = [];
  await handleAutocomplete({
    client: clientFor(entry), attribution: "x", energyEmoji: {}, pages: new PageStore(),
    settings: { get: (guildId: string) => settingsStore.get(guildId), resolveCurrency: () => "EUR" as const },
  } as never, {
    guildId: setting.allowed ? "g1" : null, user: { id: "member" },
    options: { getFocused: () => ({ name: "name", value: entry.query }) },
    respond: async (value: { name: string; value: string }[]) => void responses.push(value),
  } as never);
  return responses[0] ?? [];
}

const evidence: { request: string; expectedGame: string; selectedId: string | null; game: string; setReachable: boolean; fallback: string | null }[] = [];
const settingsStore = store();

function assertMeaning(entry: (typeof corpus.cases)[number], setting: (typeof corpus.settings)[number], result: Result) {
  const expected = entry.expectedGame[setting.id];
  if (entry.expectNoMatch || expected === "none") expect(result.game).toBe("none");
  else if (expected === "ptcg") expect(result.game).toBe("ptcg");
  else if (expected === "pocket") expect(result.game).toBe("pocket");
  else expect(result.id).not.toBeNull();
  if (entry.mustNotReturn && (expected === "ptcg" || expected === "none")) expect(result.id?.toLowerCase()).not.toBe(entry.mustNotReturn.toLowerCase());
  if (entry.mustNotReturnName) expect(result.name).not.toBe(entry.mustNotReturnName);
  if (entry.setId && expected !== "pocket") expect(result.setReachable).toBe(true);
  // A requested set must constrain the selected printing, not just the list.
  if (entry.kind === "trailing-set-code" || entry.kind === "explicit-set-hint") {
    if (expected === "ptcg" && entry.physicalId) {
      expect(result.id?.toLowerCase().replace(/[^a-z0-9]/g, "")).toBe(
        entry.physicalId.toLowerCase().replace(/[^a-z0-9]/g, ""),
      );
    }
  }
}

describe("selection corpus: production helper across settings", () => {
  for (const entry of corpus.cases) {
    for (const setting of corpus.settings) {
      it(`${entry.id} / ${setting.id}`, async () => {
        const result = await runLookup(entry, setting);
        evidence.push({
          request: `${entry.id}/${setting.id}`,
          expectedGame: entry.expectedGame[setting.id],
          selectedId: result.id,
          game: result.game,
          setReachable: result.setReachable,
          fallback: result.fallback,
        });
        assertMeaning(entry, setting, result);
      });
    }
  }
});

describe("selection corpus: public entry points", () => {
  for (const setting of corpus.settings) {
    it(`mention, slash card and autocomplete agree on ${setting.id}`, async () => {
      settingsStore.update("g1", {
        cardGames: setting.allowed ?? "both",
        defaultCardGame: setting.default ?? "ptcg",
      });
      const entry = corpus.cases.find((case_) => case_.id === "clefairy-shared")!;
      const mentionReplies = await runMessage(entry, setting, settingsStore);
      const slashPayloads = await runSlash(entry, setting, settingsStore);
      const choices = await runAutocomplete(entry, setting, settingsStore);
      expect(mentionReplies).toHaveLength(1);
      expect(slashPayloads).toHaveLength(1);
      expect(choices.length).toBeGreaterThan(0);
      assertDelivered(entry, setting, mentionReplies[0]!);
      assertDelivered(entry, setting, slashPayloads[0]!);
      const expected = entry.expectedGame[setting.id];
      if (expected === "ptcg" || expected === "pocket") {
        const wantsPocket = expected === "pocket";
        expect(choices.every((choice) => isPocketCardId(choice.value) === wantsPocket)).toBe(true);
        const mentionId = payloadIds(mentionReplies[0]!).find((id) => isPocketCardId(id) === wantsPocket)!;
        const slashId = payloadIds(slashPayloads[0]!).find((id) => isPocketCardId(id) === wantsPocket)!;
        expect(mentionId.toLowerCase()).toBe(slashId.toLowerCase());
      }
    });
  }

  it("delivers the captured LOR printing through slash and inline in every setting", async () => {
    const cases = corpus.cases.filter((entry) => entry.id === "clefairy-lor-pipe" || entry.id === "clefairy-lor-literal");
    expect(cases.map((entry) => entry.id).sort()).toEqual(["clefairy-lor-literal", "clefairy-lor-pipe"]);
    for (const setting of corpus.settings) {
      settingsStore.update("g1", {
        cardGames: setting.allowed ?? "both",
        defaultCardGame: setting.default ?? "ptcg",
      });
      for (const entry of cases) {
        const payloads = [...await runSlash(entry, setting, settingsStore), ...await runMessage(entry, setting, settingsStore)];
        expect(payloads).toHaveLength(2);
        for (const payload of payloads) {
          const json = JSON.stringify(payload);
          expect(json).toContain("swsh11-062");
          expect(json).not.toContain("me03-030");
          expect(json).toContain("Moon-Watching Party");
          expect(json).toContain("Wonder Storm");
          expect(json).not.toContain("Follow Me");
        }
      }
    }
  });

  it("uses persisted settings after a database reopen", async () => {
    settingsStore.update("g1", { cardGames: "ptcg", defaultCardGame: "ptcg" });
    settingsStore.close();
    const reopened = store();
    const entry = corpus.cases.find((case_) => case_.id === "clefairy-shared")!;
    const choices = await runAutocomplete(entry, corpus.settings[0]!, reopened);
    expect(choices.some((choice) => isPocketCardId(choice.value))).toBe(false);
    reopened.update("g1", { cardGames: "pocket", defaultCardGame: "pocket" });
    const switched = await runAutocomplete(entry, corpus.settings[1]!, reopened);
    expect(switched.some((choice) => isPocketCardId(choice.value))).toBe(true);
    reopened.close();
  });

  it("lets an explicit override beat a physical default", async () => {
    const store_ = store();
    store_.update("g1", { cardGames: "both", defaultCardGame: "ptcg" });
    const entry = corpus.cases.find((case_) => case_.id === "package-only-mega-mewtwo-y")!;
    const result = await runLookup(entry, corpus.settings[2]!);
    expect(result.game).toBe("none");
    const explicit = await lookupCard(clientFor(entry), "Mega Mewtwo Y ex", "pocket", { gamePreference: { allowed: "both", default: "ptcg" } });
    expect(explicit?.card.id.toLowerCase()).toBe("pc-002");
    store_.close();
  });
});

describe("selection corpus: result caps and order", () => {
  it("keeps the autocomplete option cap and label limit at 24, 25 and 26 candidates", async () => {
    for (const count of [24, 25, 26]) {
      const responses: { name: string; value: string }[][] = [];
      const summaries = Array.from({ length: count }, (_, index) => ({
        id: `sv01-${String(index + 1).padStart(3, "0")}`,
        name: "Clefairy " + "x".repeat(120),
        localId: String(index + 1),
      })) as CardSummary[];
      await handleAutocomplete({
        client: { searchByName: async () => summaries } as unknown as TcgdexClient,
        attribution: "x", energyEmoji: {},
      } as never, {
        guildId: null, user: { id: "member" },
        options: { getFocused: () => ({ name: "name", value: "Clefairy" }) },
        respond: async (value: { name: string; value: string }[]) => void responses.push(value),
      } as never);
      const choices = responses[0] ?? [];
      expect(choices.length).toBeLessThanOrEqual(25);
      expect(choices.every((choice) => choice.name.length <= 100)).toBe(true);
    }
  });

  it("caps quick-swap buttons at five while the full list keeps every printing", () => {
    const alternates = Array.from({ length: 11 }, (_, index) => ({ id: `sv01-${index + 1}`, name: "Clefairy" }));
    const reply = cardReply({ card: baseCard, alternates, matchingPrintings: alternates }, "member");
    const rows = reply.components!.flatMap((row) => (row as { toJSON: () => { components: { custom_id?: string }[] } }).toJSON().components);
    expect(rows.filter((component) => component.custom_id?.startsWith("printing:"))).toHaveLength(5);
  });

  it("preserves game meaning when the catalogue reverses response order", async () => {
    const entry = corpus.cases.find((case_) => case_.id === "clefairy-shared")!;
    for (const setting of corpus.settings) {
      const forward = await runLookup(entry, setting);
      const reversed = await runLookup(entry, setting, true);
      expect(reversed.game).toBe(forward.game);
    }
  });
});

describe("selection corpus: declared caps are executed", () => {
  it("caps quick swaps at ten candidates at the 9, 10 and 11 boundaries", async () => {
    for (const count of [9, 10, 11]) {
      const summaries = Array.from({ length: count + 1 }, (_, index) => ({
        id: `sv01-${String(index + 1).padStart(3, "0")}`,
        name: "Clefairy",
        localId: String(index + 1),
      })) as CardSummary[];
      const client = {
        searchByName: async () => summaries,
        getCard: async (id: string) => ({ ...baseCard, id, name: "Clefairy" }),
      } as unknown as TcgdexClient;
      const result = await lookupCard(client, "Clefairy", undefined, { gamePreference: { allowed: "ptcg", default: "ptcg" } });
      expect(result?.alternates).toHaveLength(Math.min(count, 10));
    }
  });

  it("caps stored search rows at 250 at the 249, 250 and 251 boundaries", () => {
    for (const count of [249, 250, 251]) {
      const pages = new PageStore();
      const groups = Array.from({ length: count }, (_, index) => ({
        representative: { id: `sv01-${index + 1}`, name: "Clefairy", text: "Clefairy", category: "Pokemon" as const },
        printings: 1,
      }));
      const reply = searchReply("Clefairy", groups, "TCGdex", "member", pages);
      const token = (reply as { components: { toJSON: () => { components: { custom_id?: string }[] } }[] }).components
        .flatMap((row) => row.toJSON().components.map((component) => component.custom_id ?? ""))
        .map((id) => /^open:([^:]+)$/.exec(id)?.[1])
        .find((value) => value !== undefined)!;
      expect(pages.get(token)!.items).toHaveLength(Math.min(count, 250));
    }
  });
});

describe("selection corpus: stale and expired controls", () => {
  it("answers an expired page token clearly and refuses a non-owner", async () => {
    let now = 0;
    const pages = new PageStore({ ttlMs: 100, now: () => now });
    const token = pages.put({ title: "List", items: [{ cardId: "sv01-001", heading: "One" }], perPage: 5, ownerId: "owner", footer: "Source" });
    now = 101;
    expect(pages.get(token)).toBeUndefined();
    const replies: Record<string, unknown>[] = [];
    const { handlePageButton } = await import("../src/discord/commands.js");
    await handlePageButton({ client: clientFor(corpus.cases[0]!), attribution: "x", energyEmoji: {}, pages } as never, {
      customId: `page:${token}:0`, user: { id: "owner" },
      reply: async (payload: Record<string, unknown>) => void replies.push(payload),
    } as never);
    expect(replies[0]?.content).toContain("expired");
  });
});

describe("selection corpus: fresh exploratory pass", () => {
  it("never offers Pocket to a physical-default server across shared names", async () => {
    const seen = new Set<string>();
    const shared: { name: string; id: string }[] = [];
    for (const card of textIndex) {
      const key = normaliseName(card.name);
      if (!key || seen.has(key) || key.length < 2) continue;
      seen.add(key);
      shared.push({ name: card.name, id: card.id });
      if (shared.length >= 60) break;
    }
    expect(shared.length).toBe(60);
    const fake = {
      searchByName: async (query: string) => shared.filter((card) => normaliseName(card.name).includes(normaliseName(query))).map((card) => ({ id: card.id, name: card.name, localId: card.id.split("-").at(-1)! })),
      getCard: async (id: string) => ({ ...baseCard, id, name: shared.find((card) => card.id === id)?.name ?? "Clefairy" }),
    } as unknown as TcgdexClient;
    for (const card of shared) {
      const result = await lookupCard(fake, card.name, undefined, { gamePreference: { allowed: "both", default: "ptcg" } });
      if (result && isPocketCardId(result.card.id)) throw new Error(`Pocket leaked for ${card.name}: ${result.card.id}`);
    }
  });
});
