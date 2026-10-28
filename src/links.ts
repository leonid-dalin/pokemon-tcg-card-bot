import { SET_INDEX } from "./data/set-index.js";

const byId = new Map(SET_INDEX.map((entry) => [entry.id, entry]));

/** A Pocket set id, which the physical Limitless database does not hold. The
 * package promos pa/pb print and link as P-A/P-B, so the URL uses that form. */
const POCKET = /^(?:[ab]\d+[a-z]?|p[ab]?-[ab]?|p[ab])$/i;
const PROMO_URL = /^p([ab])$/i;

function split(cardId: string): { prefix: string; number: string } | undefined {
  const at = cardId.lastIndexOf("-");
  if (at <= 0 || at === cardId.length - 1) return undefined;
  return { prefix: cardId.slice(0, at), number: cardId.slice(at + 1) };
}

/** The number as a player writes it: `001` prints as 1, `GG65` stays `GG65`. */
function bareNumber(number: string): string {
  return number.replace(/^0+(?=\d)/, "");
}

/**
 * The Limitless page for a card, which lists its play history. Physical sets
 * link from the set-index code; Pocket cards link from their own database
 * using the id prefix as written.
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
  // A code like CRZ:GG names the Galarian Gallery: the part after the colon
  // prefixes the number, so swsh12.5gg-GG65 lands on CRZ/GG65.
  const [set, suffix] = entry.code.split(":");
  const number = suffix && !parts.number.startsWith(suffix) ? `${suffix}${parts.number}` : parts.number;
  return `https://limitlesstcg.com/cards/${set}/${bareNumber(number)}`;
}

/**
 * The Cardmarket listing search for a card, in the Search format the site's own
 * UI builds. Cardmarket blocks deep product links to non-browsers, so the
 * search for the name with its printed set code is the reliable entry point.
 * Pocket sets have no code and no Cardmarket listings, so they get no link.
 */
export function cardmarketUrl(cardId: string, name: string): string | undefined {
  const parts = split(cardId);
  const entry = parts ? byId.get(parts.prefix) : undefined;
  if (!parts || !entry?.code) return undefined;
  const query = `${name} ${entry.code.replace(":", " ")}`;
  return `https://www.cardmarket.com/en/Pokemon/Products/Search?category=-1&searchString=${encodeURIComponent(query).replaceAll("%20", "+")}&category=-1&searchMode=v2`;
}
