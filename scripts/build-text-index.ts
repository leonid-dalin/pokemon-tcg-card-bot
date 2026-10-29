import { TcgdexClient } from "../src/api/tcgdex.js";
import { entryFor, manifestFor, readManifest, upsertEntry, writeAtomic } from "./lib/publish.js";
import { buildTextIndex } from "./lib/text-index.js";
const TARGET = "src/data/text-index.json";
const MANIFEST = "src/data/data-manifest.json";
const SOURCE = "https://api.tcgdex.net/v2";

const client = new TcgdexClient({ timeoutMs: 20_000, retries: 4 });

const summaries = await client.listCards();
console.log(`cards to inspect: ${summaries.length}`);

const outcome = await buildTextIndex(summaries, (id) => client.getCard(id));

if (outcome.status === "failed") {
  console.error(`${outcome.reason}; index left unchanged`);
  process.exitCode = 1;
} else {
  const entries = outcome.entries;
  entries.sort((a, b) => a.id.localeCompare(b.id));
  const rendered = `${JSON.stringify(entries)}\n`;
  writeAtomic(TARGET, rendered);
  const generatedAt = new Date().toISOString();
  const manifest = upsertEntry(readManifest(MANIFEST), SOURCE, entryFor(TARGET, rendered, entries.length, generatedAt));
  writeAtomic(MANIFEST, manifestFor(manifest.source, manifest.entries));
  const bytes = Buffer.byteLength(rendered);
  console.log(`wrote ${TARGET}: ${entries.length} cards with text, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
}
