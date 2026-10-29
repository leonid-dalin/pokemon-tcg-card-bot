import { readFileSync } from "node:fs";
import { TcgdexClient } from "../src/api/tcgdex.js";
import type { SetIndexEntry } from "../src/data/set-index.js";
import { entryFor, manifestFor, readManifest, upsertEntry, writeAtomic } from "./lib/publish.js";
import { describeChanges, mergeEntry, renderModule, setIndexOutcome, sortEntries, splitModule, type SetDetailResult } from "./lib/set-index.js";

const TARGET = "src/data/set-index.ts";
const MANIFEST = "src/data/data-manifest.json";
const SOURCE = "https://api.tcgdex.net/v2";

const client = new TcgdexClient({ timeoutMs: 20_000, retries: 3 });
const sets = await client.listSets();
const previous = splitModule(readFileSync(TARGET, "utf8"));
const known = new Map(previous.entries.map((entry) => [entry.id, entry]));

const results: SetDetailResult[] = [];
let failed = 0;

for (const [position, summary] of sets.entries()) {
  try {
    results.push({ summary, detail: await client.getSet(summary.id), failed: false });
  } catch {
    failed += 1;
    results.push({ summary, failed: true });
  }
  if ((position + 1) % 25 === 0) console.log(`fetched ${position + 1}/${sets.length}`);
}

const outcome = setIndexOutcome(results);
if (outcome.status === "failed") {
  console.error(`${outcome.reason}; leaving the runtime index unchanged`);
  process.exitCode = 1;
} else {
  const entries: SetIndexEntry[] = sortEntries(results.map((result) => mergeEntry(result, known.get(result.summary.id))));
  const changes = describeChanges(entries, known);
  for (const line of changes) console.log(line);
}
