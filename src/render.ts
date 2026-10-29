import type { Attack, Card, CardSetRef, Pricing, SetSummary } from "./api/types.js";
import type { ParsedDeck } from "./decklist.js";
import type { ResolvedLine } from "./deck-check.js";
import { isBasicEnergy } from "./deck-check.js";
import { energyCost } from "./energy.js";
import { isPocketCard, prizeCount } from "./prizes.js";
import { printedNumber } from "./printed.js";
import { normaliseName } from "./resolve.js";
import { SET_INDEX } from "./data/set-index.js";
import { convertFromEur, formatPrice } from "./currency.js";
import type { Currency } from "./settings-store.js";

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

/** Default source credit for embeds. */
export const DEFAULT_ATTRIBUTION = "Card data from TCGdex · tcgdex.com";
const FIELD_VALUE_LIMIT = 1024;

/** Returns a complete image URL, or undefined when the card has no image. */
export function cardImage(card: Card, size: "high" | "low" = "high"): string | undefined {
  if (!card.image) return undefined;
  // Preserve file URLs; expand TCGdex image paths with the requested size.
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

function attackName(attack: Attack, emoji: Record<string, string>): string {
  const cost = energyCost(attack.cost, emoji);
  const damage = attack.damage !== undefined && attack.damage !== null ? `  ${attack.damage}` : "";
  return truncate([cost, `${attack.name}${damage}`].filter(Boolean).join("  "), 250);
}

function attackValue(attack: Attack): string {
  return truncate(attack.effect ?? "");
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

// Nested TCGplayer prices prefer the normal variant when present.
function flattenTcgplayer(raw: NonNullable<Card["pricing"]>["tcgplayer"]): Pricing | undefined {
  if (!raw) return undefined;
  if (typeof raw.avg === "number" || typeof raw.trend === "number") return raw as Pricing;
  const variants = Object.entries(raw as Record<string, { marketPrice?: number | null } | undefined>);
  if (variants.length === 0) return undefined;
  const normal = variants.find(([name]) => name === "normal") ?? variants.find(([, price]) => price?.marketPrice != null);
  const market = normal?.[1]?.marketPrice;
  return typeof market === "number" && !Number.isNaN(market) ? { unit: "USD", avg: market } : undefined;
}

function pickPricing(card: Card): PriceSummary {
  const perSource: PriceSummary = {};
  for (const variant of card.variants_detailed ?? []) {
    const pricing = variant.pricing;
    if (!pricing) continue;
    // Select each source independently, with variant objects before card-level data.
    if (pricing.cardmarket && !perSource.cardmarket) perSource.cardmarket = pricing.cardmarket;
    if (pricing.tcgplayer && !perSource.tcgplayer) perSource.tcgplayer = pricing.tcgplayer;
  }
  const cardPricing = card.pricing;
  if (!perSource.cardmarket && cardPricing?.cardmarket) perSource.cardmarket = cardPricing.cardmarket;
  if (!perSource.tcgplayer) perSource.tcgplayer = flattenTcgplayer(cardPricing?.tcgplayer);
  return perSource;
}

/** Reads the selected Cardmarket average for deck totals. */
export function cardmarketAverage(card: Card): number | undefined {
  const { cardmarket } = pickPricing(card);
  const avg = cardmarket?.avg;
  return typeof avg === "number" && !Number.isNaN(avg) ? avg : undefined;
}

/** Formats available price and trend data as a small table, or returns undefined when none can be shown. */
export function priceField(card: Card, currency: Currency = "EUR"): EmbedField | undefined {
  const { cardmarket, tcgplayer } = pickPricing(card);
  const rows: string[] = [];
  const show = (amount: number | null | undefined, source: string): string =>
    `\`${source.padEnd(10)}\` ${amount === null || amount === undefined ? "" : formatPrice(amount, currency)}`.trimEnd();
  // TCGplayer quotes in USD, so its rows convert from USD rather than from EUR.
  const showUsd = (amountUsd: number, source: string): string =>
    `\`${source.padEnd(10)}\` ${formatPrice(amountUsd / convertFromEur(1, "USD"), currency)}`;

  if (cardmarket) {
    const avg = cardmarket.avg ?? cardmarket.trend;
    if (avg !== null && avg !== undefined && !Number.isNaN(avg)) rows.push(show(avg, "Market"));
    if (cardmarket.low !== null && cardmarket.low !== undefined) rows.push(show(cardmarket.low, "Low"));
    const trend =
      cardmarket.avg7 !== null && cardmarket.avg7 !== undefined
        ? { label: "7d", amount: cardmarket.avg7 }
        : cardmarket.avg30 !== null && cardmarket.avg30 !== undefined
          ? { label: "30d", amount: cardmarket.avg30 }
          : undefined;
    if (trend) rows.push(show(trend.amount, trend.label));
  }
  if (tcgplayer) {
    const market = tcgplayer.avg ?? tcgplayer.trend;
    if (market !== null && market !== undefined && !Number.isNaN(market)) rows.push(showUsd(market, "TCGplayer"));
  }
  if (!rows.length) return undefined;

  const source = cardmarket ? "Cardmarket" : "TCGplayer";
  const updated = formatDate(cardmarket?.updated ?? tcgplayer?.updated);
  return {
    name: `Prices (${source})`,
    value: truncate(`${rows.join("\n")}${updated ? `\nUpdated ${updated}` : ""}`),
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
  currency?: Currency;
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

/** Builds the card-front embed with gameplay fields and the available scan. */
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
    fields.push({ name: attackName(attack, options.energyEmoji ?? {}), value: attackValue(attack) || "\u200b", inline: false });
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

/** Builds a scan embed with a title and source credit, without gameplay fields. */
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

/** Builds set, collector, legality and pricing fields for a details reply. */
export function renderCardDetails(
  card: Card,
  alternates: { id: string; name: string }[],
  options: RenderOptions = {},
): EmbedView {
  const fields: EmbedField[] = [];
  const set = card.set;
  // Use the indexed release date when the card's set summary omits it.
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
  const prices = priceField(card, options.currency ?? "EUR");
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

/** Builds a compact search summary with up to fifteen printing labels. */
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

/** Formats a parsed deck and its supplied total, with optional legality and price data. */
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
 * Formats the Cardmarket total and priced-copy coverage.
 * Excludes resolved Basic Energy and includes unresolved copies in coverage.
 * Returns undefined when no copies have an average price.
 */
export function deckPrice(resolved: ResolvedLine[]): string | undefined {
  let total = 0;
  let priced = 0;
  // Coverage includes every copy except resolved Basic Energy.
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
