const LETTERS: Record<string, string> = {
  Grass: "G",
  Fire: "R",
  Water: "W",
  Lightning: "L",
  Psychic: "P",
  Fighting: "F",
  Darkness: "D",
  Metal: "M",
  Fairy: "Y",
  Dragon: "N",
  Colorless: "C",
};

/** Formats costs with configured emoji, falling back to bracketed type codes. */
export function energyCost(cost: string[] | undefined, emoji: Record<string, string> = {}): string {
  if (!cost || cost.length === 0) return "";
  // A cost reads as one bracket of letters in order, so every type joins inside
  // the same pair of brackets: three Psychic then Colorless is [PPPC].
  const letters = cost.map((type) => emoji[type] ? "" : (LETTERS[type] ?? type)).join("");
  const tokens = cost.map((type) => emoji[type] ?? "").join("");
  if (tokens && !letters) return tokens;
  if (tokens) return `${tokens}[${letters}]`;
  return `[${letters}]`;
}
