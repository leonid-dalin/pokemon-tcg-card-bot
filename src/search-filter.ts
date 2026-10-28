import type { TextHit } from "./text-search.js";

export const CATEGORIES = ["Pokemon", "Trainer", "Energy"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Filter = "all" | Category;

export function categoryOf(group: { representative: TextHit }): Category | undefined {
  return group.representative.category;
}

export function filterGroups<T extends { representative: TextHit }>(groups: T[], filter: Filter): T[] {
  return filter === "all" ? groups : groups.filter((group) => categoryOf(group) === filter);
}

export function groupCounts(groups: { representative: TextHit }[]): Record<Filter, number> {
  const counts: Record<Filter, number> = { all: groups.length, Pokemon: 0, Trainer: 0, Energy: 0 };
  for (const group of groups) {
    const category = categoryOf(group);
    if (category) counts[category] += 1;
  }
  return counts;
}

/** Only the filters that would show a card, so an empty category is not offered. */
export function filterOptions(groups: { representative: TextHit }[]): Filter[] {
  const counts = groupCounts(groups);
  return (["all", ...CATEGORIES] as Filter[]).filter((filter) => filter === "all" || counts[filter] > 0);
}
