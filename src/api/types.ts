export interface CardSetRef {
  id: string;
  name: string;
  cardCount?: { official?: number; total?: number };
  logo?: string;
  symbol?: string;
  serie?: { id: string; name: string };
  releaseDate?: string;
}

export interface Attack {
  cost?: string[];
  name: string;
  effect?: string;
  damage?: number | string;
}

export interface Ability {
  type: string;
  name: string;
  effect?: string;
}

export interface Pricing {
  unit?: string;
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  avg1?: number | null;
  avg7?: number | null;
  avg30?: number | null;
  updated?: string;
  idProduct?: number | null;
}

export interface VariantDetail {
  type?: string;
  size?: string;
  variantId?: string;
  pricing?: {
    cardmarket?: Pricing | null;
    tcgplayer?: Pricing | null;
  } | null;
}

/** Card-level pricing, which some records carry without variant detail. */
export interface CardPricing {
  cardmarket?: Pricing | null;
  tcgplayer?: Pricing | null;
}

export interface Card {
  pricing?: CardPricing | null;
  id: string;
  localId?: string;
  name: string;
  image?: string;
  rarity?: string;
  category?: string;
  hp?: number;
  types?: string[];
  stage?: string;
  evolveFrom?: string;
  suffix?: string;
  regulationMark?: string;
  illustrator?: string;
  retreat?: number;
  weaknesses?: { type: string; value: string }[];
  resistances?: { type: string; value: string }[];
  attacks?: Attack[];
  abilities?: Ability[];
  /** Trainer and Energy card wording. */
  effect?: string;
  /** Item, Supporter, Stadium or Tool on a Trainer card. */
  trainerType?: string;
  legal?: { standard?: boolean; expanded?: boolean; unlimited?: boolean };
  set?: CardSetRef;
  variants_detailed?: VariantDetail[];
  variants?: Record<string, boolean>;
  updated?: string;
  points?: number;
}

export interface CardSummary {
  id: string;
  localId?: string;
  name: string;
  image?: string;
}

export interface SetSummary {
  id: string;
  name: string;
  cardCount?: { official?: number; total?: number };
  logo?: string;
  symbol?: string;
  releaseDate?: string;
  serie?: { id: string; name: string };
}
