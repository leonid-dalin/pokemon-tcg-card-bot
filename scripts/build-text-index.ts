import { existsSync, readFileSync } from "node:fs";
import { TcgdexClient, TcgdexError } from "../src/api/tcgdex.js";
import type { Card } from "../src/api/types.js";
import { entryFor, manifestFor, readManifest, upsertEntry, writeAtomic } from "./lib/publish.js";

const CONCURRENCY = 6;
const TARGET = "src/data/text-index.json";
const MANIFEST = "src/data/data-manifest.json";
const SOURCE = "https://api.tcgdex.net/v2";

interface IndexedPart {
  kind: "ability" | "attack" | "effect";
  name?: string;
  text: string;
}

interface IndexedCard {
  id: string;
  name: string;
  text: string;
  category: "Pokemon" | "Trainer" | "Energy";
  parts: IndexedPart[];
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

function partsOf(card: Card): IndexedPart[] {
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

const summaries = await client.listCards();
console.log(`cards to inspect: ${summaries.length}`);

const entries: IndexedCard[] = [];
let done = 0;
const failures: string[] = [];

for (let start = 0; start < summaries.length; start += CONCURRENCY) {
  const batch = summaries.slice(start, start + CONCURRENCY);
  const results = await Promise.all(
    batch.map(async (summary) => {
      try {
        const card = await client.getCard(summary.id);
        const text = textOf(card);
        const category: IndexedCard["category"] = card.category === "Trainer" || card.category === "Energy" ? card.category : "Pokemon";
        return text.length > 0 ? { id: summary.id, name: summary.name, text, category, parts: partsOf(card) } : undefined;
      } catch (error) {
        // Skip missing records; other fetch failures prevent replacing the index.
        if (error instanceof TcgdexError && error.status === 404) return undefined;
        failures.push(summary.id);
        return undefined;
      }
    }),
  );
  for (const result of results) if (result) entries.push(result);
  done += batch.length;
  if (done % 1000 < CONCURRENCY) console.log(`inspected ${done}/${summaries.length}, kept ${entries.length}`);
}

// Preserve the previous index after non-404 failures.
// Setting exitCode allows pending transport cleanup to finish.
if (failures.length > 0) {
  console.error(`${failures.length} cards failed, index left unchanged: ${failures.slice(0, 20).join(", ")}`);
  process.exitCode = 1;
} else {
  entries.sort((a, b) => a.id.localeCompare(b.id));
  const rendered = `${JSON.stringify(entries)}\n`;
  writeAtomic(TARGET, rendered);
  const generatedAt = new Date().toISOString();
  const manifest = upsertEntry(readManifest(MANIFEST), SOURCE, entryFor(TARGET, rendered, entries.length, generatedAt));
  writeAtomic(MANIFEST, manifestFor(manifest.source, manifest.entries));
  const bytes = Buffer.byteLength(rendered);
  console.log(`wrote ${TARGET}: ${entries.length} cards with text, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
}
