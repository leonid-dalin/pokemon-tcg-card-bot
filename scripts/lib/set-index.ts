import type { SetSummary } from "../../src/api/types.js";
import type { SetIndexEntry } from "../../src/data/set-index.js";

export interface SetDetail {
  id: string;
  name: string;
  abbreviation?: { official?: string; shortened?: string };
  releaseDate?: string;
}

export interface SetDetailResult {
  summary: SetSummary;
  detail?: SetDetail;
  failed: boolean;
}

/**
 * Keeps a curated value when the upstream record omits it, so a partial response
 * never erases a code or date somebody already checked.
 */
export function mergeEntry(result: SetDetailResult, previous?: SetIndexEntry): SetIndexEntry {
  const detail = result.detail;
  const id = detail?.id ?? result.summary.id;
  const name = detail?.name ?? result.summary.name;
  // Upstream nests the code under "official"; older snapshots stored a plain string.
  const upstream = detail?.abbreviation;
  const code = (typeof upstream === "string" ? upstream : upstream?.official) ?? previous?.code;
  // The detail record wins; a summary date outranks a value already curated.
  const releaseDate = detail?.releaseDate ?? result.summary.releaseDate ?? previous?.releaseDate;
  return {
    id,
    name,
    ...(code ? { code } : {}),
    ...(releaseDate ? { releaseDate } : {}),
  };
}

/** Reports exactly the fields that differ, so a name-only change never prints a code pair. */
export type SetIndexOutcome = { status: "ok"; results: SetDetailResult[] } | { status: "failed"; reason: string };

/** Publishes only a complete run: no empty list, no failed detail request. */
export function setIndexOutcome(results: SetDetailResult[]): SetIndexOutcome {
  if (results.length === 0) return { status: "failed", reason: "the set list came back empty" };
  const failed = results.filter((result) => result.failed).length;
  if (failed > 0) return { status: "failed", reason: `${failed} set details failed` };
  return { status: "ok", results };
}

export function describeChanges(entries: SetIndexEntry[], known: Map<string, SetIndexEntry>): string[] {
  return entries.flatMap((entry) => {
    const before = known.get(entry.id);
    if (!before) return entry.code || entry.releaseDate ? [`added ${entry.id}`] : [];
    const fields = [
      before.name !== entry.name ? `name ${JSON.stringify(before.name)} -> ${JSON.stringify(entry.name)}` : undefined,
      before.code !== entry.code ? `code ${before.code ?? "-"} -> ${entry.code ?? "-"}` : undefined,
      before.releaseDate !== entry.releaseDate ? `date ${before.releaseDate ?? "-"} -> ${entry.releaseDate ?? "-"}` : undefined,
    ].filter((line) => line !== undefined);
    return fields.length > 0 ? [`changed ${entry.id}: ${fields.join("; ")}`] : [];
  });
}

export function sortEntries(entries: SetIndexEntry[]): SetIndexEntry[] {
  return [...entries].sort(
    (a, b) => (a.releaseDate ?? "").localeCompare(b.releaseDate ?? "") || a.id.localeCompare(b.id),
  );
}

const literal = (value: string): string =>
  JSON.stringify(value).replace(/[\u007f-\uffff]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

function entryLine(entry: SetIndexEntry): string {
  const parts = [`id: ${literal(entry.id)}`, `name: ${literal(entry.name)}`];
  if (entry.code) parts.push(`code: ${literal(entry.code)}`);
  if (entry.releaseDate) parts.push(`releaseDate: ${literal(entry.releaseDate)}`);
  return `  { ${parts.join(", ")} },`;
}

export function renderModule(entries: SetIndexEntry[], header: string): string {
  return `${header}\n\nexport const SET_INDEX: SetIndexEntry[] = [\n${entries.map(entryLine).join("\n")}\n];\n`;
}

export function splitModule(source: string): { header: string; entries: SetIndexEntry[] } {
  const marker = "export const SET_INDEX: SetIndexEntry[] = [";
  const index = source.indexOf(marker);
  if (index < 0) throw new Error("set-index module has no SET_INDEX array");
  const header = source.slice(0, index).replace(/\s*$/, "");
  const entries: SetIndexEntry[] = [];
  const pattern = /\{ id: ("(?:[^"\\]|\\.)*"), name: ("(?:[^"\\]|\\.)*")([^}]*)\}/g;
  for (const match of source.slice(index).matchAll(pattern)) {
    const id = match[1];
    const name = match[2];
    if (!id || !name) continue;
    const tail = match[3] ?? "";
    const read = (key: string): string | undefined => {
      const found = tail.match(new RegExp(`${key}: ("(?:[^"\\\\]|\\\\.)*")`))?.[1];
      if (found === undefined) return undefined;
      // Parse the literal so escapes like \u00e9 survive a re-render unchanged.
      return JSON.parse(found) as string;
    };
    const code = read("code");
    const releaseDate = read("releaseDate");
    entries.push({
      id: JSON.parse(id) as string,
      name: JSON.parse(name) as string,
      ...(code ? { code } : {}),
      ...(releaseDate ? { releaseDate } : {}),
    });
  }
  return { header, entries };
}
