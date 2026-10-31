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
  truncated?: boolean;
}

/** A legal deck fits well inside this; the cap bounds upstream work per message. */
export const MAX_DECK_LINES = 80;

const HEADER = /^(pok[eé]mon|trainer|energy|total cards)\s*:?\s*(\d+)?\s*$/i;
const CARD_LINE = /^(\d{1,2})\s+(.+?)(?:\s+([A-Z][A-Z0-9]{1,4})\s+(\d{1,3}))?$/;
const TOTAL_LINE = /^total cards\s*:?\s*(\d+)/i;

/** Parses a pasted decklist, returning undefined below the row or card thresholds. */
export function parseDecklist(text: string): ParsedDeck | undefined {
  const rawLines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rawLines.length < 5) return undefined;

  const lines: DeckLine[] = [];
  const sections: { label: string; count: number }[] = [];
  let declaredTotal: number | undefined;
  let truncated = false;

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
    // Reject malformed rows before the cap, so a stray row after a full deck does
    // not make the list look truncated.
    if (!Number.isFinite(count) || count < 1 || count > 20 || name.length < 2) continue;
    if (lines.length >= MAX_DECK_LINES) {
      truncated = true;
      break;
    }
    lines.push({
      count,
      name,
      ...(card[3] ? { setCode: card[3] } : {}),
      ...(card[4] ? { number: card[4] } : {}),
    });
  }

  // Require enough parsed rows and cards to distinguish a list from ordinary chat.
  if (lines.length < 5) return undefined;
  const total = lines.reduce((sum, line) => sum + line.count, 0);
  if (total < 10) return undefined;

  return {
    lines,
    total: declaredTotal ?? total,
    sections,
    ...(truncated ? { truncated: true } : {}),
  };
}
