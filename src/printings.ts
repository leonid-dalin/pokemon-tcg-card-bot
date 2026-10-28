import type { TcgdexClient } from "./api/tcgdex.js";
import { getPocketCard, searchPocketByName } from "./api/pocket.js";
import { printedNumber } from "./printed.js";
import { normaliseName, setIdOf } from "./resolve.js";
import { SET_INDEX } from "./data/set-index.js";
import { searchWithAccents } from "./lookup.js";
import { isPocketCard } from "./prizes.js";

export interface Printing {
  id: string;
  name: string;
  /** Set name and release year, from the set index or the Pocket data. */
  setLabel: string;
}

const setById = new Map(SET_INDEX.map((entry) => [normaliseName(entry.id), entry]));

const pocketDate = (cardId: string): string | undefined => getPocketCard(cardId)?.set?.releaseDate;

/** The date a printing's set released, whichever source holds it. */
function releaseDateOf(cardId: string): string | undefined {
  return isPocketCard({ id: cardId, name: "" } as never) ? pocketDate(cardId) : setById.get(normaliseName(setIdOf(cardId)))?.releaseDate;
}

/** The label a printing row shows: set name and release year. */
function labelOf(cardId: string, date: string | undefined): string {
  if (isPocketCard({ id: cardId, name: "" } as never)) {
    const set = getPocketCard(cardId)?.set;
    return [set?.name, date?.slice(0, 4)].filter(Boolean).join(" ");
  }
  const set = setById.get(normaliseName(setIdOf(cardId)));
  return [set?.name, date?.slice(0, 4)].filter(Boolean).join(" ");
}

/** The two sources case the same Pocket printing differently; package promos aside. */
const pocketKey = (id: string): string => (isPocketCard({ id, name: "" } as never) ? id.toLowerCase() : id);

/**
 * Every printing whose normalised name equals the chosen card's, newest first.
 *
 * A Pocket id must come from the Pocket package: TCGdex serves a handful of
 * Pocket sets under ids that collide with nothing, and its own Pocket entries
 * carry no set year, so reading the set label from the Pocket record is the
 * only way that row says which set it came from. The two sources case the same
 * Pocket printing differently, so a package row wins its upstream alias.
 */
export async function printingsOf(client: TcgdexClient, name: string): Promise<Printing[]> {
  const wanted = normaliseName(name);
  if (!wanted) return [];

  const rows: { printing: Printing; date?: string; fromPackage: boolean }[] = [];
  try {
    for (const card of await searchWithAccents(client, name)) {
      if (normaliseName(card.name) !== wanted) continue;
      const date = releaseDateOf(card.id);
      rows.push({ printing: { id: card.id, name: card.name, setLabel: labelOf(card.id, date) }, date, fromPackage: false });
    }
  } catch {
    // A dead TCGdex still leaves the Pocket printings to show.
  }

  for (const card of searchPocketByName(name)) {
    if (normaliseName(card.name) !== wanted) continue;
    const date = releaseDateOf(card.id);
    rows.push({ printing: { id: card.id, name: card.name, setLabel: labelOf(card.id, date) }, date, fromPackage: true });
  }

  const byIdentity = new Map<string, { printing: Printing; date?: string; fromPackage: boolean }>();
  for (const row of rows) {
    const existing = byIdentity.get(pocketKey(row.printing.id));
    if (!existing || (!existing.fromPackage && row.fromPackage)) byIdentity.set(pocketKey(row.printing.id), row);
  }

  // Undated rows cannot claim a place in the chronology, so they follow the
  // dated ones, ordered by id.
  const unique = [...byIdentity.values()];
  unique.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.printing.id.localeCompare(b.printing.id));
  return unique.map((row) => row.printing);
}

/** `TWM 130 · Twilight Masquerade 2024`, the row for one printing. */
export function printingHeading(printing: Printing): string {
  return [printedNumber(printing.id), printing.setLabel].filter(Boolean).join(" · ");
}

export function printingItems(printings: Printing[]): { cardId: string; heading: string }[] {
  return printings.map((printing) => ({ cardId: printing.id, heading: printingHeading(printing) }));
}
