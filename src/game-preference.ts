import type { CardGameDefault, CardGameScope } from "./settings-store.js";

export interface GamePreference {
  allowed: CardGameScope;
  default: CardGameDefault;
}

export type EffectiveGame = "ptcg" | "pocket" | "both";

export function effectiveGame(preference: GamePreference | undefined): EffectiveGame {
  if (!preference) return "both";
  if (preference.allowed === "ptcg") return "ptcg";
  if (preference.allowed === "pocket") return "pocket";
  return preference.default;
}
