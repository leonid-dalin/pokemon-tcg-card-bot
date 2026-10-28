import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from "discord.js";
import { CATEGORIES, filterGroups, filterOptions, groupCounts, type Filter } from "../search-filter.js";

export interface ListItem {
  cardId: string;
  heading: string;
  detail?: string;
  /** Pokemon, Trainer or Energy, when the list offers a filter. */
  category?: string;
}

export interface ListPage {
  title: string;
  items: ListItem[];
  perPage: number;
  ownerId: string;
  footer: string;
  /** Show category filter controls for this page. */
  filterable?: boolean;
  /** Counts across all matches, used for filter labels and truncation notices. */
  categoryCounts?: Record<string, number>;
  /** Total matches before the display cap. */
  universeTotal?: number;
  /** Per-view display limit. Searches set this; other lists have no limit. */
  displayCap?: number;
}

/** Bounded list storage with fixed expiry times; reads do not renew a page. */
export class PageStore {
  private readonly pages = new Map<string, { page: ListPage; expires: number }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: { maxEntries?: number; ttlMs?: number; now?: () => number } = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 500);
    this.ttlMs = options.ttlMs ?? 15 * 60_000;
    this.now = options.now ?? Date.now;
  }

  /** Stores a page under a new token, evicting oldest entries when full. */
  put(page: ListPage): string {
    this.prune();
    while (this.pages.size >= this.maxEntries) {
      const oldest = this.pages.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.pages.delete(oldest);
    }
    let token: string;
    do {
      token = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
    } while (this.pages.has(token));
    this.pages.set(token, { page, expires: this.now() + this.ttlMs });
    return token;
  }

  /** Returns an unexpired page, or undefined for a missing or expired token. */
  get(token: string): ListPage | undefined {
    const entry = this.pages.get(token);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.pages.delete(token);
      return undefined;
    }
    return entry.page;
  }

  private prune(): void {
    const now = this.now();
    for (const [token, entry] of this.pages) {
      if (entry.expires <= now) this.pages.delete(token);
    }
  }
}

const clampIndex = (page: ListPage, index: number): number => {
  const totalPages = Math.max(1, Math.ceil(page.items.length / page.perPage));
  return Math.max(0, Math.min(totalPages - 1, Math.floor(index)));
};

export function pageTokenFrom(customId: string): string | undefined {
  const page = /^page:([^:]+):\d+(?::[^:]+)?$/.exec(customId);
  const open = /^open:([^:]+)$/.exec(customId);
  return page?.[1] ?? open?.[1];
}

export function pageIndexFrom(customId: string): number | undefined {
  const match = /^page:[^:]+:(\d+)(?::[^:]+)?$/.exec(customId);
  return match ? Number(match[1]) : undefined;
}

export function pageFilterFrom(customId: string): string | undefined {
  const match = /^page:[^:]+:\d+:([^:]+)$/.exec(customId);
  return match?.[1];
}

// Add a notice when the matching item count exceeds the view's display cap.
function viewFooter(page: ListPage, applied: string | undefined): string {
  if (page.displayCap === undefined) return page.footer;
  const total = applied === undefined || applied === "all"
    ? page.universeTotal ?? page.items.length
    : page.categoryCounts?.[applied];
  if (total === undefined || total <= page.displayCap) return page.footer;
  return `${page.footer} · the first ${page.displayCap} of ${total}`;
}

/** Maximum number of search results shown in one view. */
export const LIST_CAP = 250;

export function listReply(page: ListPage, token: string, index: number, filter?: string): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
} {
  // Apply the search cap to both the full list and filtered views.
  const cap = page.displayCap;
  const narrowed =
    filter === undefined || filter === "all"
      ? cap
        ? page.items.slice(0, cap)
        : page.items
      : cap
        ? filteredItems(page, filter).slice(0, cap)
        : filteredItems(page, filter);
  // Reset an empty filter to the full stored item set.
  const emptyChoice = narrowed.length === 0 && page.items.length > 0 && filter !== undefined && filter !== "all";
  const items = emptyChoice ? page.items : narrowed;
  const applied = emptyChoice ? undefined : filter;
  const current = clampIndex({ ...page, items }, index);
  // Use the total for the active view in the truncation notice.
  const footer = viewFooter(page, applied);
  const totalPages = Math.max(1, Math.ceil(items.length / page.perPage));
  const start = current * page.perPage;
  const shown = items.slice(start, start + page.perPage);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(page.title).setFooter({ text: footer });
  const description = shown.map((item) => `${item.heading}${item.detail ? `\n${item.detail}` : ""}`).join("\n\n");
  if (description) embed.setDescription(description);
  if (emptyChoice) embed.setDescription(`${FILTER_LABELS[filter!] ?? filter} has no card in these results. Showing all of them.`);

  const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  if (totalPages > 1) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    row.addComponents(
      new ButtonBuilder().setCustomId(`page:${token}:${current - 1}:${applied ?? "all"}`).setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
      new ButtonBuilder().setCustomId(`page-label:${token}`).setLabel(`${current + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`page:${token}:${current + 1}:${applied ?? "all"}`).setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(current === totalPages - 1),
    );
    components.push(row as ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>);
  }

  if (page.filterable) {
    // Keep all filter choices available after narrowing the list.
    const choices = filterChoices(page.items, page.categoryCounts);
    // Omit the filter menu when it has no alternative category.
    if (choices.length > 2) {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`filter:${token}`)
        .setPlaceholder("Show only")
        .addOptions(choices.map((choice) => ({ label: choice.label, value: choice.value, default: choice.value === (applied ?? "all") })));
      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu) as ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>);
    }
  }

  if (shown.length > 0) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`open:${token}`)
      .setPlaceholder("Open a card")
      .addOptions(shown.map((item) => ({ label: item.heading.replace(/\*\*/g, "").slice(0, 100), value: item.cardId })));
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu) as ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>);
  }

  return { embeds: [embed], components };
}

export const FILTER_LABELS: Record<string, string> = {
  all: "All cards",
  Pokemon: "Pokémon",
  Trainer: "Trainers",
  Energy: "Energy",
};

function asGroup(item: ListItem): { representative: { category: string | undefined } } {
  return { representative: { category: item.category } };
}

function filteredItems(page: ListPage, filter?: string): ListItem[] {
  const groups = page.items.map(asGroup);
  const kept = new Set(filterGroups(groups, (filter ?? "all") as Filter));
  return page.items.filter((_, index) => kept.has(groups[index]!));
}

// Use complete match totals for filter labels when the page supplies them.
function filterChoices(items: ListItem[], universe?: Record<string, number>): { label: string; value: string }[] {
  if (universe) {
    const all = Object.values(universe).reduce((total, count) => total + count, 0);
    const available = ([...CATEGORIES] as Filter[]).filter((filter) => (universe[filter] ?? 0) > 0);
    return [
      { label: `${FILTER_LABELS.all} (${all})`, value: "all" },
      ...available.map((filter) => ({ label: `${FILTER_LABELS[filter] ?? filter} (${universe[filter]})`, value: filter })),
    ];
  }
  const groups = items.map(asGroup);
  const counts = groupCounts(groups);
  return filterOptions(groups).map((filter) => ({ label: `${FILTER_LABELS[filter] ?? filter} (${counts[filter]})`, value: filter }));
}

export function filterTokenFrom(customId: string): string | undefined {
  const match = /^filter:([^:]+)$/.exec(customId);
  return match?.[1];
}
