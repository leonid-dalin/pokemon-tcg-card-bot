export interface DeckLine {
  count: number;
  name: string;
  setCode?: string;
  number?: string;
}

export interface ParsedDeck {
  lines: DeckLine[];
  total: number;
  sections: { label: string; count: number }[];
}

const HEADER = /^(pok[eé]mon|trainer|energy|total cards)\s*:?\s*(\d+)?\s*$/i;
const CARD_LINE = /^(\d{1,2})\s+(.+?)(?:\s+([A-Z][A-Z0-9]{1,4})\s+(\d{1,3}))?$/;
const TOTAL_LINE = /^total cards\s*:?\s*(\d+)/i;

/**
 * Read a pasted PTCGL decklist. The format is a count, a card name and an
 * optional set code plus number, grouped under section headers. Returns
 * undefined for ordinary chat so the caller can stay quiet.
 */
export function parseDecklist(text: string): ParsedDeck | undefined {
  const rawLines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rawLines.length < 5) return undefined;

  const lines: DeckLine[] = [];
  const sections: { label: string; count: number }[] = [];
  let declaredTotal: number | undefined;

  for (const line of rawLines) {
    const total = line.match(TOTAL_LINE);
    if (total) {
      declaredTotal = Number.parseInt(total[1] ?? "", 10);
      continue;
    }

    const header = line.match(HEADER);
    if (header) {
      sections.push({ label: (header[1] ?? "").replace(/^\w/, (c) => c.toUpperCase()), count: Number(header[2] ?? 0) });
      continue;
    }

    const card = line.match(CARD_LINE);
    if (!card) continue;
    const count = Number.parseInt(card[1] ?? "", 10);
    const name = (card[2] ?? "").trim();
    // Energy lines run to a dozen, so the ceiling is generous but still rejects a
    // stray total that happens to look like a card line.
    if (!Number.isFinite(count) || count < 1 || count > 20 || name.length < 2) continue;
    lines.push({
      count,
      name,
      ...(card[3] ? { setCode: card[3] } : {}),
      ...(card[4] ? { number: card[4] } : {}),
    });
  }

  // Ordinary chat can produce one or two matching lines; a deck has many.
  if (lines.length < 5) return undefined;
  const total = lines.reduce((sum, line) => sum + line.count, 0);
  if (total < 10) return undefined;

  return {
    lines,
    total: declaredTotal ?? total,
    sections,
  };
}
