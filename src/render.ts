import type { Attack, Card, CardSetRef, Pricing, SetSummary } from "./api/types.js";
import type { ParsedDeck } from "./decklist.js";
import type { ResolvedLine } from "./deck-check.js";
import { isBasicEnergy } from "./deck-check.js";
import { energyCost } from "./energy.js";
import { isPocketCard, prizeCount } from "./prizes.js";
import { printedNumber } from "./printed.js";
import { normaliseName } from "./resolve.js";
import { SET_INDEX } from "./data/set-index.js";

const setById = new Map(SET_INDEX.map((entry) => [normaliseName(entry.id), entry]));

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

export function formatStage(stage: string | undefined): string | undefined {
  if (!stage) return undefined;
  return stage.replace(/^Stage(\d+)$/, "Stage $1");
}

function attackName(attack: Attack): string {
  return truncate(`${attack.name}${attack.damage !== undefined && attack.damage !== null ? `  ${attack.damage}` : ""}`, 250);
}

function attackValue(attack: Attack, emoji: Record<string, string>): string {
  const cost = energyCost(attack.cost, emoji);
  return truncate([cost, attack.effect].filter(Boolean).join("\n"));
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
  const perSource: PriceSummary = {};
  for (const variant of card.variants_detailed ?? []) {
    const pricing = variant.pricing;
    if (!pricing) continue;
    // Per-source accumulation: a variant that prices only TCGplayer must not
    // hide the Cardmarket figure another variant or the card itself carries.
    if (pricing.cardmarket && !perSource.cardmarket) perSource.cardmarket = pricing.cardmarket;
    if (pricing.tcgplayer && !perSource.tcgplayer) perSource.tcgplayer = pricing.tcgplayer;
  }
  const cardPricing = card.pricing;
  if (!perSource.cardmarket && cardPricing?.cardmarket) perSource.cardmarket = cardPricing.cardmarket;
  if (!perSource.tcgplayer && cardPricing?.tcgplayer) perSource.tcgplayer = cardPricing.tcgplayer;
  return perSource;
}

/** The Cardmarket average for a card, which the price field and the deck price share. */
export function cardmarketAverage(card: Card): number | undefined {
  const { cardmarket } = pickPricing(card);
  const avg = cardmarket?.avg;
  return typeof avg === "number" && !Number.isNaN(avg) ? avg : undefined;
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
  attribution?: string;
  energyEmoji?: Record<string, string>;
}

function cardProfile(card: Card): string | undefined {
  const count = prizeCount(card);
  const reward = count > 1 ? `${count} ${isPocketCard(card) ? "Points" : "Prizes"}` : undefined;
  if (card.category === "Trainer" || card.category === "Energy") return [card.category, card.trainerType].filter(Boolean).join(" · ");
  return [
    card.hp ? `${card.hp} HP` : undefined,
    card.types?.length ? card.types.join("/") : undefined,
    formatStage(card.stage),
    card.evolveFrom ? `from ${card.evolveFrom}` : undefined,
    reward,
  ]
    .filter(Boolean)
    .join(" · ");
}

function cardDescription(card: Card): string | undefined {
  if (card.category === "Trainer" || card.category === "Energy") return card.effect;
  return cardProfile(card);
}

function sharedCardView(card: Card, options: RenderOptions, fields: EmbedField[], description?: string): EmbedView {
  const image = cardImage(card);
  const footer = [printedNumber(card.id), card.regulationMark ? `Reg ${card.regulationMark}` : undefined, options.attribution ?? DEFAULT_ATTRIBUTION]
    .filter(Boolean)
    .join(" · ");
  return {
    title: truncate(card.name, 250),
    ...(image ? { url: image } : {}),
    color: cardColour(card),
    ...(description ? { description: truncate(description, FIELD_VALUE_LIMIT) } : image ? {} : { description: "No scan is available for this printing." }),
    fields,
    ...(image ? { imageUrl: image } : {}),
    ...(card.set?.symbol ? { thumbnailUrl: `${card.set.symbol}.webp` } : {}),
    footer,
  };
}

export function renderCard(card: Card, options: RenderOptions = {}): EmbedView {
  const fields: EmbedField[] = [];

  const profile = cardProfile(card);
  if (profile && (card.category === "Trainer" || card.category === "Energy")) {
    fields.push({ name: "Card", value: truncate(profile), inline: true });
  }

  for (const ability of card.abilities ?? []) {
    fields.push({ name: `Ability: ${ability.name}`, value: truncate(ability.effect ?? "", FIELD_VALUE_LIMIT) });
  }
  for (const attack of card.attacks ?? []) {
    fields.push({ name: attackName(attack), value: attackValue(attack, options.energyEmoji ?? {}), inline: false });
  }
  for (const weakness of card.weaknesses ?? []) {
    fields.push({ name: "Weakness", value: `${weakness.type} ${weakness.value}`, inline: true });
  }
  for (const resistance of card.resistances ?? []) {
    fields.push({ name: "Resistance", value: `${resistance.type} ${resistance.value}`, inline: true });
  }
  if (card.retreat !== undefined) fields.push({ name: "Retreat", value: String(card.retreat), inline: true });

  return sharedCardView(card, options, fields, cardDescription(card));
}

/** The scan alone, for a mention that asks for the picture and nothing else. */
export function renderCardImage(card: Card, options: RenderOptions = {}): EmbedView {
  const image = cardImage(card);
  return {
    title: truncate(`${card.name} · ${printedNumber(card.id)}`, 250),
    ...(image ? { url: image } : {}),
    color: cardColour(card),
    fields: [],
    ...(image ? { imageUrl: image } : { description: "No scan is available for this printing." }),
    footer: options.attribution ?? DEFAULT_ATTRIBUTION,
  };
}

export function renderCardDetails(
  card: Card,
  alternates: { id: string; name: string }[],
  options: RenderOptions = {},
): EmbedView {
  const fields: EmbedField[] = [];
  const set = card.set;
  // The card response embeds only a set summary, so the release date falls back
  // to the committed set index. A source-provided date stays first choice.
  const indexedSet = setById.get(normaliseName(set?.id ?? ""));
  const setValue = [
    set?.name,
    printedNumber(card.id),
    formatDate(set?.releaseDate ?? indexedSet?.releaseDate),
    set?.serie?.name,
  ]
    .filter(Boolean)
    .join(" · ");
  if (setValue) fields.push({ name: "Set", value: truncate(setValue), inline: true });
  if (card.rarity) fields.push({ name: "Rarity", value: truncate(card.rarity), inline: true });
  if (card.illustrator) fields.push({ name: "Illustrator", value: truncate(card.illustrator), inline: true });
  const legal = legalityLine(card);
  if (legal) fields.push({ name: "Legal", value: truncate(legal), inline: true });
  const prices = priceField(card);
  if (prices) fields.push(prices);
  const unique = [...new Map(alternates.filter((entry) => entry.id !== card.id).map((entry) => [entry.id, entry])).values()];
  if (unique.length) fields.push({ name: "Other printings", value: unique.map((entry) => printedNumber(entry.id)).join(", ") });
  const image = cardImage(card);
  return {
    title: truncate(card.name, 250),
    ...(image ? { url: image } : {}),
    color: cardColour(card),
    fields,
    footer: options.attribution ?? DEFAULT_ATTRIBUTION,
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
export function renderDecklist(deck: ParsedDeck, resolved?: ResolvedLine[]): EmbedView {
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

  if (resolved) {
    const illegal = resolved.filter((entry) => entry.card && !isBasicEnergy(entry.card) && entry.card.legal?.standard === false);
    if (illegal.length > 0) {
      const lines = illegal
        .map(({ line }) => `${line.count} ${line.name}${line.setCode ? ` (${line.setCode}${line.number ? ` ${line.number}` : ""})` : ""}`)
        .join("\n");
      fields.push({ name: "Not Standard legal", value: truncate(lines, FIELD_VALUE_LIMIT) });
    }
    const price = deckPrice(resolved);
    if (price) fields.push({ name: "Deck price", value: price, inline: false });
  }

  return {
    title: "Decklist",
    color: DEFAULT_COLOUR,
    description: truncate(body, 4000),
    fields,
    footer: "Parsed from the pasted list",
  };
}

/**
 * The deck's cost from the Cardmarket average of each priced line. Lines whose
 * printing carries no price are left out of the sum and named in the count, so
 * a reader can see how much of the deck the figure covers.
 */
export function deckPrice(resolved: ResolvedLine[]): string | undefined {
  let total = 0;
  let priced = 0;
  // A line counts towards the coverage even when it resolved to no card, so a
  // deck half-unresolved does not claim full coverage.
  let eligible = 0;
  for (const { line, card } of resolved) {
    if (card && isBasicEnergy(card)) continue;
    eligible += line.count;
    if (!card) continue;
    const average = cardmarketAverage(card);
    if (average === undefined) continue;
    total += average * line.count;
    priced += line.count;
  }
  if (priced === 0) return undefined;
  return `≈ ${total.toFixed(2)} EUR (Cardmarket average, ${priced} of ${eligible} cards priced)`;
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
