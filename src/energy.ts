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
  return (cost ?? []).map((type) => emoji[type] ?? `[${LETTERS[type] ?? type}]`).join("");
}
