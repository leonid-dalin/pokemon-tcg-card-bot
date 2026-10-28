import type { TcgdexClient } from "./api/tcgdex.js";
import { getPocketCard, searchPocketByName } from "./api/pocket.js";
import { printedNumber } from "./printed.js";
import { normaliseName, setIdOf } from "./resolve.js";
import { SET_INDEX } from "./data/set-index.js";
import { setRecency } from "./set-index.js";

export interface Printing {
  id: string;
  name: string;
  /** Set name and release year, from the set index or the Pocket data. */
  setLabel: string;
}

const setById = new Map(SET_INDEX.map((entry) => [normaliseName(entry.id), entry]));

/**
 * Every printing whose normalised name equals the chosen card's, newest first.
 *
 * A Pocket id must come from the Pocket package: TCGdex serves a handful of
 * Pocket sets under ids that collide with nothing, and its own Pocket entries
 * carry no set year, so reading the set label from the Pocket record is the
 * only way that row says which set it came from.
 */
export async function printingsOf(client: TcgdexClient, name: string): Promise<Printing[]> {
  const wanted = normaliseName(name);
  if (!wanted) return [];

  const others: Printing[] = [];
  try {
    for (const card of await client.searchByName(name)) {
      if (normaliseName(card.name) !== wanted) continue;
      others.push({ id: card.id, name: card.name, setLabel: setLabelOf(card.id) });
    }
  } catch {
    // A dead TCGdex still leaves the Pocket printings to show.
  }

  for (const card of searchPocketByName(name)) {
    if (normaliseName(card.name) !== wanted) continue;
    const pocket = getPocketCard(card.id);
    const set = pocket?.set;
    const year = set?.releaseDate?.slice(0, 4);
    others.push({ id: card.id, name: card.name, setLabel: [set?.name, year].filter(Boolean).join(" ") });
  }

  const unique = [...new Map(others.map((printing) => [printing.id, printing])).values()];
  unique.sort((a, b) => setRecency(b.id) - setRecency(a.id) || a.id.localeCompare(b.id));
  return unique;
}

function setLabelOf(cardId: string): string {
  const set = setById.get(normaliseName(setIdOf(cardId)));
  const year = set?.releaseDate?.slice(0, 4);
  if (!set && !year) return "";
  return [set?.name, year].filter(Boolean).join(" ");
}

/** `TWM 130 · Twilight Masquerade 2024`, the row for one printing. */
export function printingHeading(printing: Printing): string {
  return [printedNumber(printing.id), printing.setLabel].filter(Boolean).join(" · ");
}

export function printingItems(printings: Printing[]): { cardId: string; heading: string }[] {
  return printings.map((printing) => ({ cardId: printing.id, heading: printingHeading(printing) }));
}
