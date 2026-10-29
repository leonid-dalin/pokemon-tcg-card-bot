import type { Card } from "../../src/api/types.js";

export interface IndexedPart {
  kind: "ability" | "attack" | "effect";
  name?: string;
  text: string;
}

export interface IndexedCard {
  id: string;
  name: string;
  text: string;
  category: "Pokemon" | "Trainer" | "Energy";
  parts: IndexedPart[];
}

export function textOf(card: Card): string {
  const parts: string[] = [];
  if (card.effect) parts.push(card.effect);
  for (const ability of card.abilities ?? []) {
    parts.push(`${ability.name}. ${ability.effect ?? ""}`);
  }
  for (const attack of card.attacks ?? []) {
    parts.push(`${attack.name}. ${attack.effect ?? ""}`);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function partsOf(card: Card): IndexedPart[] {
  const parts: IndexedPart[] = [];
  if (card.effect) parts.push({ kind: "effect", text: card.effect });
  for (const ability of card.abilities ?? []) {
    parts.push({ kind: "ability", name: ability.name, text: ability.effect ?? "" });
  }
  for (const attack of card.attacks ?? []) {
    parts.push({ kind: "attack", name: attack.name, text: attack.effect ?? "" });
  }
  return parts;
}

export function categoryOf(card: Card): IndexedCard["category"] {
  return card.category === "Trainer" || card.category === "Energy" ? card.category : "Pokemon";
}

export type CardFetcher = (id: string) => Promise<Card>;

export interface CollectResult {
  entries: IndexedCard[];
  skippedMissing: number;
  failures: string[];
}

/**
 * Walks the summaries and collects indexed wording. A 404 skips one card;
 * any other failure is reported, because an upstream outage must not publish.
 */
export async function collectTextEntries(
  summaries: { id: string; name: string }[],
  getCard: CardFetcher,
  concurrency = 6,
): Promise<CollectResult> {
  const entries: IndexedCard[] = [];
  let skippedMissing = 0;
  const failures: string[] = [];
  let done = 0;

  for (let start = 0; start < summaries.length; start += concurrency) {
    const batch = summaries.slice(start, start + concurrency);
    const results = await Promise.all(
      batch.map(async (summary) => {
        try {
          const card = await getCard(summary.id);
          const text = textOf(card);
          if (text.length === 0) return undefined;
          return {
            id: summary.id,
            name: summary.name,
            text,
            category: categoryOf(card),
            parts: partsOf(card),
          } satisfies IndexedCard;
        } catch (error) {
          if ((error as { status?: number }).status === 404) {
            skippedMissing += 1;
            return undefined;
          }
          failures.push(summary.id);
          return undefined;
        }
      }),
    );
    for (const result of results) if (result) entries.push(result);
    done += batch.length;
    if (done % 1000 < concurrency) console.log(`inspected ${done}/${summaries.length}, kept ${entries.length}`);
  }

  return { entries, skippedMissing, failures };
}

export type BuildTextOutcome =
  | { status: "ok"; entries: IndexedCard[] }
  | { status: "failed"; reason: string };

/** Publishes only a complete run: no empty list, no all-404 run, no transport failure. */
export async function buildTextIndex(
  summaries: { id: string; name: string }[],
  getCard: CardFetcher,
): Promise<BuildTextOutcome> {
  if (summaries.length === 0) {
    return { status: "failed", reason: "the card list came back empty" };
  }
  const { entries, skippedMissing, failures } = await collectTextEntries(summaries, getCard);
  if (failures.length > 0) {
    return { status: "failed", reason: `${failures.length} card details failed: ${failures.slice(0, 20).join(", ")}` };
  }
  if (entries.length === 0) {
    return {
      status: "failed",
      reason: `${skippedMissing} cards were missing and the rest carry no wording; refusing to publish an empty index`,
    };
  }
  return { status: "ok", entries };
}
