import { SET_INDEX } from "./data/set-index.js";

const byId = new Map(SET_INDEX.map((entry) => [entry.id, entry]));

// Pocket cards use the separate Pocket Limitless database.
const POCKET = /^(?:[ab]\d+[a-z]?|p[ab]?-[ab]?|p[ab])$/i;
const PROMO_URL = /^p([ab])$/i;

function split(cardId: string): { prefix: string; number: string } | undefined {
  const at = cardId.lastIndexOf("-");
  if (at <= 0 || at === cardId.length - 1) return undefined;
  return { prefix: cardId.slice(0, at), number: cardId.slice(at + 1) };
}

function bareNumber(number: string): string {
  return number.replace(/^0+(?=\d)/, "");
}

/**
 * Builds a physical or Pocket Limitless card URL.
 * Returns undefined for malformed IDs or physical sets without a printed code.
 */
export function limitlessUrl(cardId: string): string | undefined {
  const parts = split(cardId);
  if (!parts) return undefined;
  if (POCKET.test(parts.prefix)) {
    const promo = PROMO_URL.exec(parts.prefix);
    const set = promo ? `P-${promo[1]!.toUpperCase()}` : parts.prefix;
    return `https://pocket.limitlesstcg.com/cards/${set}/${bareNumber(parts.number)}`;
  }
  const entry = byId.get(parts.prefix);
  if (!entry?.code) return undefined;
  // Gallery codes such as CRZ:GG supply a number prefix when the ID omits it.
  const [set, suffix] = entry.code.split(":");
  const number = suffix && !parts.number.startsWith(suffix) ? `${suffix}${parts.number}` : parts.number;
  return `https://limitlesstcg.com/cards/${set}/${bareNumber(number)}`;
}

/**
 * Builds a Cardmarket search URL from the name and indexed set code.
 * Returns undefined when the ID has no indexed printed code.
 */
export function cardmarketUrl(cardId: string, name: string): string | undefined {
  const parts = split(cardId);
  const entry = parts ? byId.get(parts.prefix) : undefined;
  if (!parts || !entry?.code) return undefined;
  const query = `${name} ${entry.code.replace(":", " ")}`;
  return `https://www.cardmarket.com/en/Pokemon/Products/Search?category=-1&searchString=${encodeURIComponent(query).replaceAll("%20", "+")}&category=-1&searchMode=v2`;
}
