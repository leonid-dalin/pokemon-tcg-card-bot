import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Card, CardSummary } from "./types.js";

/**
 * Pocket cards from the PocketDecks `pokemon-tcg-pocket-cards` package.
 *
 * TCGdex covers the physical game well but its Pocket catalogue stops before
 * Deluxe Pack: Mega, so cards like Crustle ex are missing entirely. This reads
 * the package's v5 data instead: a collection file per set with printing
 * metadata, and a gameplay file with the attacks.
 */
// Node's own resolver finds the package from this module, so the bot starts
// from any working directory, in a checkout or from dist.
const PACKAGE_ROOT = join(
  dirname(createRequire(import.meta.url).resolve("pokemon-tcg-pocket-cards/package.json")),
  "data",
  "v5",
);

interface AlternateVersion {
  set_code: string;
  set_name: string;
  id: number;
  rarity?: string;
}

interface CollectionRecord {
  id: string;
  name: string;
  set_code: string;
  set_name: string;
  release_date?: string;
  rarity?: string;
  artist?: string;
  image?: string;
  alternate_versions?: AlternateVersion[];
}

interface GameplayAttack {
  cost?: string | null;
  name?: string | null;
  damage?: number | string | null;
  effect?: string | null;
}

interface GameplayRecord {
  id: string;
  name: string;
  /** "Pokémon" or "Trainer". */
  type?: string;
  /** The energy type on a Pokémon, or Item, Supporter, Tool or Stadium on a Trainer. */
  subtype?: string;
  /** Trainer wording. */
  card_text?: string;
  stage?: string;
  evolves_from?: string;
  health?: number;
  retreat?: number;
  weakness?: string;
  ability?: { exists?: boolean; name?: string | null; effect?: string | null };
  attacks?: Record<string, GameplayAttack>;
  ex?: boolean;
  image?: string;
}

const ENERGY_BY_LETTER: Record<string, string> = {
  G: "Grass",
  R: "Fire",
  W: "Water",
  L: "Lightning",
  P: "Psychic",
  F: "Fighting",
  D: "Darkness",
  M: "Metal",
  N: "Dragon",
  C: "Colorless",
};

function decodeCost(cost?: string | null): string[] | undefined {
  if (!cost) return undefined;
  const letters = [...cost.toUpperCase()].map((letter) => ENERGY_BY_LETTER[letter] ?? letter);
  return letters.length > 0 ? letters : undefined;
}

function alternateIdOf(alternate: AlternateVersion): string {
  return `${alternate.set_code}-${String(alternate.id).padStart(3, "0")}`;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

interface PocketIndex {
  cards: Map<string, Card>;
  byName: Map<string, CardSummary[]>;
}

let cached: PocketIndex | undefined;

function loadIndex(): PocketIndex {
  if (cached) return cached;

  const root = PACKAGE_ROOT;
  const sets = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const cards = new Map<string, Card>();
  const byName = new Map<string, CardSummary[]>();

  // A reprint carries gameplay only under its first printing, which can sit in
  // another set (Professor's Research a4b-373 reads its text from pa-007), so
  // gameplay is indexed across every set before any card is built.
  const collections: CollectionRecord[][] = [];
  const gameplayById = new Map<string, GameplayRecord>();
  for (const setCode of sets) {
    const dir = join(root, setCode);
    try {
      collections.push(readJson<CollectionRecord[]>(join(dir, `${setCode}.collection.json`)));
    } catch {
      continue;
    }
    try {
      for (const record of readJson<GameplayRecord[]>(join(dir, `${setCode}.gameplay.json`))) {
        gameplayById.set(record.id, record);
      }
    } catch {
      // a set without gameplay data still lists its printings
    }
  }

  for (const collection of collections) {
    for (const record of collection) {
      const parent =
        gameplayById.get(record.id) ??
        (record.alternate_versions ?? [])
          .map((alternate) => gameplayById.get(alternateIdOf(alternate)))
          .find((play) => play !== undefined);
      const trainer = parent?.type === "Trainer";

      const attacks = Object.values(parent?.attacks ?? {})
        .filter((attack) => attack.name)
        .map((attack) => ({
          ...(decodeCost(attack.cost) ? { cost: decodeCost(attack.cost) } : {}),
          name: String(attack.name),
          ...(attack.damage !== null && attack.damage !== undefined ? { damage: attack.damage } : {}),
          ...(attack.effect ? { effect: attack.effect } : {}),
        }));

      const card: Card = {
        id: record.id,
        localId: record.id.split("-")[1],
        name: record.name,
        ...(record.image ? { image: record.image } : {}),
        ...(record.rarity ? { rarity: record.rarity } : {}),
        category: trainer ? "Trainer" : "Pokemon",
        ...(parent?.stage ? { stage: parent.stage } : {}),
        ...(parent?.subtype ? (trainer ? { trainerType: parent.subtype } : { types: [parent.subtype] }) : {}),
        ...(parent?.card_text ? { effect: parent.card_text } : {}),
        ...(parent?.health ? { hp: parent.health } : {}),
        ...(parent?.retreat !== undefined ? { retreat: parent.retreat } : {}),
        ...(parent?.weakness ? { weaknesses: [{ type: parent.weakness, value: "+20" }] } : {}),
        ...(parent?.ability?.exists && parent.ability.name
          ? {
              abilities: [
                {
                  type: "Ability",
                  name: parent.ability.name,
                  ...(parent.ability.effect ? { effect: parent.ability.effect } : {}),
                },
              ],
            }
          : {}),
        ...(attacks.length > 0 ? { attacks } : {}),
        ...(record.artist ? { illustrator: record.artist } : {}),
        set: {
          id: record.set_code,
          name: record.set_name,
          ...(record.release_date ? { releaseDate: record.release_date } : {}),
        },
      };

      cards.set(card.id, card);

      // Every alternate printing is its own card id, and people link those.
      for (const alternate of record.alternate_versions ?? []) {
        const alternateId = alternateIdOf(alternate);
        if (cards.has(alternateId)) continue;
        const alternateCard: Card = {
          ...card,
          id: alternateId,
          localId: String(alternate.id).padStart(3, "0"),
          ...(alternate.rarity ? { rarity: alternate.rarity } : {}),
          set: {
            id: alternate.set_code,
            name: alternate.set_name,
            ...(record.release_date ? { releaseDate: record.release_date } : {}),
          },
        };
        cards.set(alternateId, alternateCard);
      }
    }
  }

  // Built from the finished card map so each id appears once, even when a set
  // lists a printing that an earlier set already named as its alternate.
  for (const card of cards.values()) {
    const key = card.name.toLowerCase();
    const list = byName.get(key) ?? [];
    list.push({
      id: card.id,
      name: card.name,
      ...(card.localId ? { localId: card.localId } : {}),
      ...(card.image ? { image: card.image } : {}),
    });
    byName.set(key, list);
  }

  cached = { cards, byName };
  return cached;
}

/** Name search across every Pocket printing, newest set first. */
export function searchPocketByName(name: string): CardSummary[] {
  const { byName } = loadIndex();
  const query = name.trim().toLowerCase();
  if (!query) return [];

  const exact = byName.get(query) ?? [];
  if (exact.length > 0) {
    return [...exact].sort((a, b) => {
      const setA = loadIndex().cards.get(a.id)?.set?.releaseDate ?? "";
      const setB = loadIndex().cards.get(b.id)?.set?.releaseDate ?? "";
      return setB.localeCompare(setA);
    });
  }

  const partial: CardSummary[] = [];
  for (const [key, list] of byName) {
    if (key.includes(query) || query.includes(key)) partial.push(...list);
  }
  return partial;
}

export function getPocketCard(id: string): Card | undefined {
  // Package keys are lowercase, so an id from a source that cases differently
  // (TCGdex Pocket sets, a user link) still resolves.
  return loadIndex().cards.get(id) ?? loadIndex().cards.get(id.toLowerCase());
}

