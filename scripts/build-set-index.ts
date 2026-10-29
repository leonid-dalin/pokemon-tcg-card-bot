import { readFileSync } from "node:fs";
import { TcgdexClient } from "../src/api/tcgdex.js";
import type { SetIndexEntry } from "../src/data/set-index.js";
import { entryFor, manifestFor, writeAtomic } from "./lib/publish.js";
import { mergeEntry, renderModule, sortEntries, splitModule, type SetDetailResult } from "./lib/set-index.js";

const TARGET = "src/data/set-index.ts";
const MANIFEST = "src/data/data-manifest.json";

const client = new TcgdexClient({ timeoutMs: 20_000, retries: 3 });
const sets = await client.listSets();
const previous = splitModule(readFileSync(TARGET, "utf8"));
const known = new Map(previous.entries.map((entry) => [entry.id, entry]));

const results: SetDetailResult[] = [];
let failed = 0;

for (const [position, summary] of sets.entries()) {
  try {
    results.push({ summary, detail: (await client.getSet(summary.id)) as SetDetailResult["detail"], failed: false });
  } catch {
    failed += 1;
    results.push({ summary, failed: true });
  }
  if ((position + 1) % 25 === 0) console.log(`fetched ${position + 1}/${sets.length}`);
}

if (sets.length === 0) {
  console.error("upstream returned no sets; leaving the runtime index unchanged");
  process.exitCode = 1;
} else if (failed > 0) {
  console.error(`${failed} set details failed; leaving the runtime index unchanged`);
  process.exitCode = 1;
} else {
  const entries: SetIndexEntry[] = sortEntries(results.map((result) => mergeEntry(result, known.get(result.summary.id))));
  const changed = entries.filter((entry) => {
    const before = known.get(entry.id);
    return before && (before.code !== entry.code || before.releaseDate !== entry.releaseDate || before.name !== entry.name);
  });
  const rendered = renderModule(entries, previous.header);
  writeAtomic(TARGET, rendered);
  const generatedAt = new Date().toISOString();
  writeAtomic(MANIFEST, manifestFor("https://api.tcgdex.net/v2", [entryFor(TARGET, rendered, entries.length, generatedAt)]));
  const withDate = entries.filter((entry) => entry.releaseDate).length;
  const withCode = entries.filter((entry) => entry.code).length;
  console.log(`wrote ${TARGET}: ${entries.length} sets, ${withDate} with a date, ${withCode} with a code`);
  for (const entry of changed) console.log(`changed ${entry.id}: ${known.get(entry.id)?.code ?? "-"} -> ${entry.code ?? "-"}`);
}
