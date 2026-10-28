import { mkdirSync, writeFileSync } from "node:fs";
import { TcgdexClient } from "../src/api/tcgdex.js";

// Fetch set details and write src/data/set-index.json.
// Failed detail requests retain the summary ID and name without optional metadata.
// Usage: npm run index:sets
const client = new TcgdexClient({ timeoutMs: 20_000, retries: 3 });
const sets = await client.listSets();

interface IndexEntry {
  id: string;
  name: string;
  abbreviation?: string;
  releaseDate?: string;
}

const entries: IndexEntry[] = [];
let failed = 0;

for (const [position, summary] of sets.entries()) {
  try {
    const detail = (await client.getSet(summary.id)) as IndexEntry & { cards?: unknown[] };
    entries.push({
      id: detail.id,
      name: detail.name,
      ...(detail.abbreviation ? { abbreviation: detail.abbreviation } : {}),
      ...(detail.releaseDate ? { releaseDate: detail.releaseDate } : {}),
    });
  } catch {
    failed += 1;
    entries.push({ id: summary.id, name: summary.name });
  }
  if ((position + 1) % 25 === 0) console.log(`fetched ${position + 1}/${sets.length}`);
}

entries.sort((a, b) => (a.releaseDate ?? "").localeCompare(b.releaseDate ?? "") || a.id.localeCompare(b.id));

mkdirSync("src/data", { recursive: true });
writeFileSync("src/data/set-index.json", `${JSON.stringify(entries, null, 1)}\n`, "utf8");

const withDate = entries.filter((entry) => entry.releaseDate).length;
const withCode = entries.filter((entry) => entry.abbreviation).length;
console.log(`wrote src/data/set-index.json: ${entries.length} sets, ${withDate} with a release date, ${withCode} with a code, ${failed} failed`);
