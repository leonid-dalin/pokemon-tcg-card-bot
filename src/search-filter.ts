/** Category order used by search filter menus. */
export const CATEGORIES = ["Pokemon", "Trainer", "Energy"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Filter = "all" | Category;

/** Shared category view of search groups and adapted list items. */
export type Categorised = { representative: { category: string | undefined } };

export function categoryOf(group: Categorised): Category | undefined {
  return CATEGORIES.includes(group.representative.category as Category) ? (group.representative.category as Category) : undefined;
}

export function filterGroups<T extends Categorised>(groups: T[], filter: Filter): T[] {
  return filter === "all" ? groups : groups.filter((group) => categoryOf(group) === filter);
}

/** Counts all groups; unrecognised categories contribute only to the all total. */
export function groupCounts(groups: Categorised[]): Record<Filter, number> {
  const counts: Record<Filter, number> = { all: groups.length, Pokemon: 0, Trainer: 0, Energy: 0 };
  for (const group of groups) {
    const category = categoryOf(group);
    if (category) counts[category] += 1;
  }
  return counts;
}

/** Returns all plus non-empty categories, in menu order. */
export function filterOptions(groups: Categorised[]): Filter[] {
  const counts = groupCounts(groups);
  return (["all", ...CATEGORIES] as Filter[]).filter((filter) => filter === "all" || counts[filter] > 0);
}
