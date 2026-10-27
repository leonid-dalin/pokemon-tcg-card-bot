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

export interface Card {
  id: string;
  localId?: string;
  name: string;
  image?: string;
  rarity?: string;
  category?: string;
  hp?: number;
  types?: string[];
  stage?: string;
  suffix?: string;
  regulationMark?: string;
  illustrator?: string;
  retreat?: number;
  weaknesses?: { type: string; value: string }[];
  resistances?: { type: string; value: string }[];
  attacks?: Attack[];
  abilities?: Ability[];
  legal?: { standard?: boolean; expanded?: boolean; unlimited?: boolean };
  set?: CardSetRef;
  variants_detailed?: VariantDetail[];
  variants?: Record<string, boolean>;
  updated?: string;
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
