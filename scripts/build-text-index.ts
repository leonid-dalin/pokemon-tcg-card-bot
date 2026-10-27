import { writeFileSync } from "node:fs";
import { TcgdexClient } from "../src/api/tcgdex.js";
import type { Card } from "../src/api/types.js";

/**
 * Build the searchable text index.
 *
 * TCGdex only indexes Trainer wording under `effect`. Attacks and abilities are
 * not searchable there, so a phrase like "Put a Trainer card from your discard
 * pile into your hand" finds Old Rod but misses Dedenne, whose attack says the
 * same thing. This walks every card once and keeps the text worth searching.
 *
 *   npm run index:text
 *
 * It is a few minutes of requests, so run it when a set releases, not on boot.
 */
const CONCURRENCY = 6;

interface IndexedCard {
  id: string;
  name: string;
  text: string;
}

const client = new TcgdexClient({ timeoutMs: 20_000, retries: 4 });

function textOf(card: Card): string {
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

const summaries = await client.listCards();
console.log(`cards to inspect: ${summaries.length}`);

const entries: IndexedCard[] = [];
let done = 0;
let failed = 0;

for (let start = 0; start < summaries.length; start += CONCURRENCY) {
  const batch = summaries.slice(start, start + CONCURRENCY);
  const results = await Promise.all(
    batch.map(async (summary) => {
      try {
        const card = await client.getCard(summary.id);
        const text = textOf(card);
        return text.length > 0 ? { id: summary.id, name: summary.name, text } : undefined;
      } catch {
        failed += 1;
        return undefined;
      }
    }),
  );
  for (const result of results) if (result) entries.push(result);
  done += batch.length;
  if (done % 1000 < CONCURRENCY) console.log(`inspected ${done}/${summaries.length}, kept ${entries.length}`);
}

entries.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync("src/data/text-index.json", `${JSON.stringify(entries)}\n`, "utf8");

const bytes = Buffer.byteLength(JSON.stringify(entries));
console.log(`wrote src/data/text-index.json: ${entries.length} cards with text, ${(bytes / 1024 / 1024).toFixed(1)} MB, ${failed} failed`);
