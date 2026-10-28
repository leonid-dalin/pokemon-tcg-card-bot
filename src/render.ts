import type { Ability, Attack, Card, CardSetRef, Pricing, SetSummary } from "./api/types.js";
import type { ParsedDeck } from "./decklist.js";
import { printedNumber } from "./printed.js";

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface EmbedView {
  title: string;
  url?: string;
  color: number;
  description?: string;
  fields: EmbedField[];
  imageUrl?: string;
  thumbnailUrl?: string;
  footer?: string;
}

const TYPE_COLOURS: Record<string, number> = {
  Grass: 0x4caf50,
  Fire: 0xf4511e,
  Water: 0x1e88e5,
  Lightning: 0xfdd835,
  Psychic: 0x8e24aa,
  Fighting: 0xbf6b3b,
  Darkness: 0x37474f,
  Metal: 0x90a4ae,
  Dragon: 0xc0a000,
  Colorless: 0x9e9e9e,
  Fairy: 0xec407a,
};

const DEFAULT_COLOUR = 0x5865f2;

/** Footer credit when nothing more specific is configured. */
export const DEFAULT_ATTRIBUTION = "Card data from TCGdex";
const FIELD_VALUE_LIMIT = 1024;
const MAX_ATTACK_FIELDS = 4;

export function cardImage(card: Card, size: "high" | "low" = "high"): string | undefined {
  if (!card.image) return undefined;
  // TCGdex serves a base path that needs a size suffix; the Pocket data ships
  // complete URLs, so only append when there is no file extension already.
  return /\.(png|webp|jpe?g|gif)$/i.test(card.image) ? card.image : `${card.image}/${size}.webp`;
}

export function cardColour(card: Card): number {
  const primary = card.types?.[0];
  const colour = primary ? TYPE_COLOURS[primary] : undefined;
  return colour ?? DEFAULT_COLOUR;
}

function truncate(value: string, limit = 400): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function attackLabel(attack: Attack): string {
  const cost = attack.cost?.length ? `${attack.cost.join("+")} · ` : "";
  const damage = attack.damage !== undefined && attack.damage !== null ? ` — ${attack.damage}` : "";
  return truncate(`${cost}${attack.name}${damage}`, 250);
}

function abilityLabel(ability: Ability): string {
  return truncate(`${ability.type}: ${ability.name}`, 250);
}

function formatDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function money(amount: number | null | undefined, currency: string): string | undefined {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return undefined;
  return `${amount.toFixed(2)} ${currency}`;
}

interface PriceSummary {
  cardmarket?: Pricing;
  tcgplayer?: Pricing;
}

function pickPricing(card: Card): PriceSummary {
  for (const variant of card.variants_detailed ?? []) {
    const pricing = variant.pricing;
    if (!pricing) continue;
    if (pricing.cardmarket || pricing.tcgplayer) {
      return {
        ...(pricing.cardmarket ? { cardmarket: pricing.cardmarket } : {}),
        ...(pricing.tcgplayer ? { tcgplayer: pricing.tcgplayer } : {}),
      };
    }
  }
  return {};
}

export function priceField(card: Card): EmbedField | undefined {
  const { cardmarket, tcgplayer } = pickPricing(card);
  const lines: string[] = [];

  if (cardmarket) {
    const unit = cardmarket.unit ?? "EUR";
    const avg = money(cardmarket.avg ?? cardmarket.trend, unit);
    const low = money(cardmarket.low, unit);
    if (avg) lines.push(`Cardmarket ${avg}${low ? ` (low ${low})` : ""}`);
    const trend = [
      cardmarket.avg1 !== null && cardmarket.avg1 !== undefined ? `1d ${money(cardmarket.avg1, unit)}` : undefined,
      cardmarket.avg7 !== null && cardmarket.avg7 !== undefined ? `7d ${money(cardmarket.avg7, unit)}` : undefined,
      cardmarket.avg30 !== null && cardmarket.avg30 !== undefined ? `30d ${money(cardmarket.avg30, unit)}` : undefined,
    ].filter((entry): entry is string => Boolean(entry));
    if (trend.length > 0) lines.push(`Trend ${trend.join(" · ")}`);
  }
  if (tcgplayer) {
    const market = money(tcgplayer.avg ?? tcgplayer.trend, tcgplayer.unit ?? "USD");
    const low = money(tcgplayer.low, tcgplayer.unit ?? "USD");
    if (market) lines.push(`TCGplayer ${market}${low ? ` (low ${low})` : ""}`);
  }
  if (!lines.length) return undefined;

  const updated = formatDate(cardmarket?.updated ?? tcgplayer?.updated);
  return {
    name: "Prices",
    value: truncate(`${lines.join("\n")}${updated ? `\nUpdated ${updated}` : ""}`),
    inline: false,
  };
}

function legalityLine(card: Card): string | undefined {
  const legal = card.legal;
  if (!legal) return undefined;
  const formats = [
    legal.standard ? "Standard" : undefined,
    legal.expanded ? "Expanded" : undefined,
    legal.unlimited ? "Unlimited" : undefined,
  ].filter((value): value is string => Boolean(value));
  return formats.length ? formats.join(" · ") : "Not legal in any tracked format";
}

export interface RenderOptions {
  /** Attribution appended to every embed footer. */
  attribution?: string;
}

/**
 * Turn a card into the embed the bot posts. The field set mirrors what people
 * expect from a card lookup bot: art first, then set and number, rules text,
 * legality and both price sources.
 */
export function renderCard(card: Card, options: RenderOptions = {}): EmbedView {
  const set = card.set;
  const total = set?.cardCount?.official ?? set?.cardCount?.total;
  const number = card.localId ? `#${card.localId}${total ? `/${total}` : ""}` : undefined;
  const title = [card.name, number].filter(Boolean).join(" · ");

  const fields: EmbedField[] = [];

  const setLine = [set?.name, set?.serie?.name, card.regulationMark ? `Reg ${card.regulationMark}` : undefined]
    .filter(Boolean)
    .join(" · ");
  if (setLine) fields.push({ name: "Set", value: truncate(setLine), inline: true });

  const profile = [
    card.category,
    card.trainerType,
    card.stage,
    card.types?.length ? card.types.join("/") : undefined,
    card.hp ? `${card.hp} HP` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  if (profile) fields.push({ name: "Card", value: truncate(profile), inline: true });

  if (card.rarity) fields.push({ name: "Rarity", value: truncate(card.rarity), inline: true });

  if (card.effect) fields.push({ name: "Effect", value: truncate(card.effect, FIELD_VALUE_LIMIT) });

  for (const ability of (card.abilities ?? []).slice(0, 2)) {
    fields.push({ name: "Ability", value: truncate(`${abilityLabel(ability)}\n${ability.effect ?? ""}`) });
  }

  for (const attack of (card.attacks ?? []).slice(0, MAX_ATTACK_FIELDS)) {
    const body = attack.effect ? `${attackLabel(attack)}\n${attack.effect}` : attackLabel(attack);
    fields.push({ name: "Attack", value: truncate(body) });
  }

  const combat: string[] = [];
  if (card.weaknesses?.length) {
    combat.push(`Weakness ${card.weaknesses.map((w) => `${w.type} ${w.value}`).join(", ")}`);
  }
  if (card.resistances?.length) {
    combat.push(`Resistance ${card.resistances.map((r) => `${r.type} ${r.value}`).join(", ")}`);
  }
  if (card.retreat !== undefined) combat.push(`Retreat ${card.retreat}`);
  if (combat.length) fields.push({ name: "Combat", value: truncate(combat.join(" · ")) });

  const legality = legalityLine(card);
  if (legality) fields.push({ name: "Legal", value: truncate(legality), inline: true });

  const price = priceField(card);
  if (price) fields.push(price);

  if (card.illustrator) fields.push({ name: "Illustrator", value: truncate(card.illustrator), inline: true });

  const updated = formatDate(card.updated);
  const footer = [options.attribution ?? DEFAULT_ATTRIBUTION, updated ? `data ${updated}` : undefined]
    .filter(Boolean)
    .join(" · ");

  const image = cardImage(card);

  return {
    title: truncate(title, 250),
    // The title links to the full-size scan.
    ...(image ? { url: image } : {}),
    color: cardColour(card),
    fields,
    ...(image ? { imageUrl: image } : { description: "No scan is available for this printing." }),
    ...(set?.symbol ? { thumbnailUrl: `${set.symbol}.webp` } : {}),
    footer,
  };
}

/** List view for a text search, capped so the description stays inside limits. */
export function renderSearchResults(
  query: string,
  cards: { id: string; name: string }[],
  attribution = DEFAULT_ATTRIBUTION,
): EmbedView {
  const lines = cards
    .slice(0, 15)
    .map((card) => `\`${printedNumber(card.id)}\` ${card.name}`)
    .join("\n");
  return {
    title: `Cards mentioning "${truncate(query, 80)}"`,
    color: DEFAULT_COLOUR,
    description: truncate(`${lines}${cards.length > 15 ? `
and ${cards.length - 15} more` : ""}`, 4000),
    fields: [],
    footer: attribution,
  };
}

/** A pasted decklist, formatted, with the count checked against 60. */
export function renderDecklist(deck: ParsedDeck): EmbedView {
  const body = deck.lines
    .map((line) => {
      const printing = line.setCode ? ` (${line.setCode}${line.number ? ` ${line.number}` : ""})` : "";
      return `${line.count} ${line.name}${printing}`;
    })
    .join("\n");

  const fields: EmbedField[] = [{ name: "Cards", value: String(deck.total), inline: true }];
  if (deck.total !== 60) {
    fields.push({ name: "Count", value: `Decklists are 60 cards, this one lists ${deck.total}`, inline: true });
  }

  return {
    title: "Decklist",
    color: DEFAULT_COLOUR,
    description: truncate(body, 4000),
    fields,
    footer: "Parsed from the pasted list",
  };
}

export function renderSet(set: SetSummary | CardSetRef, attribution = DEFAULT_ATTRIBUTION): EmbedView {
  const count = set.cardCount?.official ?? set.cardCount?.total;
  const fields: EmbedField[] = [];
  if (count) fields.push({ name: "Cards", value: String(count), inline: true });
  if (set.serie?.name) fields.push({ name: "Series", value: set.serie.name, inline: true });
  if (set.releaseDate) fields.push({ name: "Released", value: set.releaseDate, inline: true });

  return {
    title: set.name,
    color: DEFAULT_COLOUR,
    fields,
    ...(set.logo ? { imageUrl: `${set.logo}.webp` } : {}),
    footer: attribution,
  };
}
