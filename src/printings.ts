import type { TcgdexClient } from "./api/tcgdex.js";
import { OverloadedError } from "./api/limiter.js";
import { getPocketCard, searchPocketByName } from "./api/pocket.js";
import { printedNumber } from "./printed.js";
import { normaliseName, setIdOf } from "./resolve.js";
import { SET_INDEX } from "./data/set-index.js";
import { searchWithAccents } from "./lookup.js";
import { isPocketCard } from "./prizes.js";

export interface Printing {
  id: string;
  name: string;
  /** Available set name and release year for display. */
  setLabel: string;
}

const setById = new Map(SET_INDEX.map((entry) => [normaliseName(entry.id), entry]));

const pocketDate = (cardId: string): string | undefined => getPocketCard(cardId)?.set?.releaseDate;

// Use package dates for Pocket cards and indexed dates for physical cards.
function releaseDateOf(cardId: string): string | undefined {
  return isPocketCard({ id: cardId, name: "" } as never) ? pocketDate(cardId) : setById.get(normaliseName(setIdOf(cardId)))?.releaseDate;
}

function labelOf(cardId: string, date: string | undefined): string {
  if (isPocketCard({ id: cardId, name: "" } as never)) {
    const set = getPocketCard(cardId)?.set;
    return [set?.name, date?.slice(0, 4)].filter(Boolean).join(" ");
  }
  const set = setById.get(normaliseName(setIdOf(cardId)));
  return [set?.name, date?.slice(0, 4)].filter(Boolean).join(" ");
}

// Fold Pocket ID casing when merging upstream and package records.
const pocketKey = (id: string): string => (isPocketCard({ id, name: "" } as never) ? id.toLowerCase() : id);

/**
 * Lists exact normalised-name matches across both catalogues, newest first.
 * Package records take precedence over upstream aliases of the same Pocket ID.
 * Upstream failures still allow package results.
 */
export async function printingsOf(client: TcgdexClient, name: string, allowed: "ptcg" | "pocket" | "both" = "both"): Promise<Printing[]> {
  const wanted = normaliseName(name);
  if (!wanted) return [];

  const rows: { printing: Printing; date?: string; fromPackage: boolean }[] = [];
  // A Pocket-only list cannot use any upstream row, so a queue refusal must not block it.
  if (allowed !== "pocket") {
    try {
      for (const card of await searchWithAccents(client, name)) {
        // TCGdex serves Pocket records too, so a physical-only list must drop them.
        if (allowed === "ptcg" && isPocketCard(card as never)) continue;
        if (normaliseName(card.name) !== wanted) continue;
        const date = releaseDateOf(card.id);
        rows.push({ printing: { id: card.id, name: card.name, setLabel: labelOf(card.id, date) }, date, fromPackage: false });
      }
    } catch (error) {
      // A refusal is not a missing card: keep it so the caller can answer busy.
      if (error instanceof OverloadedError) throw error;
      // Continue with package results after an upstream search failure.
    }
  }

  for (const card of searchPocketByName(name)) {
    if (allowed === "ptcg") continue;
    if (normaliseName(card.name) !== wanted) continue;
    const date = releaseDateOf(card.id);
    rows.push({ printing: { id: card.id, name: card.name, setLabel: labelOf(card.id, date) }, date, fromPackage: true });
  }

  const byIdentity = new Map<string, { printing: Printing; date?: string; fromPackage: boolean }>();
  for (const row of rows) {
    const existing = byIdentity.get(pocketKey(row.printing.id));
    if (!existing || (!existing.fromPackage && row.fromPackage)) byIdentity.set(pocketKey(row.printing.id), row);
  }

  // Undated rows follow dated rows. IDs break date ties.
  const unique = [...byIdentity.values()];
  unique.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.printing.id.localeCompare(b.printing.id));
  return unique.map((row) => row.printing);
}

/** Combines a printed card number with its available set label. */
export function printingHeading(printing: Printing): string {
  return [printedNumber(printing.id), printing.setLabel].filter(Boolean).join(" · ");
}

export function printingItems(printings: Printing[]): { cardId: string; heading: string }[] {
  return printings.map((printing) => ({ cardId: printing.id, heading: printingHeading(printing) }));
}
