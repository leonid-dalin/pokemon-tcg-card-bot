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
  /** Every item carries a category the filter can use. */
  filterable?: boolean;
  /** Category totals over every match, before the cap; the menu promises these. */
  categoryCounts?: Record<string, number>;
}

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

/** The filter a page button carries forward, so a press keeps the narrowed list. */
export function pageFilterFrom(customId: string): string | undefined {
  const match = /^page:[^:]+:\d+:([^:]+)$/.exec(customId);
  return match?.[1];
}

/** The display cap for an unfiltered view, shared with the search store. */
export const LIST_CAP = 250;

export function listReply(page: ListPage, token: string, index: number, filter?: string): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
} {
  // The stored union carries the first items of every category, so the all view
  // is cut to the cap again; a category filter selects from the same union.
  const narrowed = (filter === undefined || filter === "all" ? page.items.slice(0, LIST_CAP) : filteredItems(page, filter));
  // A filter that matches nothing must not blank the message: keep the full
  // list and say the choice found nothing.
  const emptyChoice = narrowed.length === 0 && page.items.length > 0 && filter !== undefined && filter !== "all";
  const items = emptyChoice ? page.items : narrowed;
  const applied = emptyChoice ? undefined : filter;
  const current = clampIndex({ ...page, items }, index);
  const totalPages = Math.max(1, Math.ceil(items.length / page.perPage));
  const start = current * page.perPage;
  const shown = items.slice(start, start + page.perPage);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(page.title).setFooter({ text: page.footer });
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
    // Choices come from the whole page, not the narrowed list, so a reader can
    // always widen the view again after picking one category.
    const choices = filterChoices(page.items, page.categoryCounts);
    // A row that can only select the current category would not change the list.
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

/** A list item seen through the shared filter helpers, which read only the category. */
function asGroup(item: ListItem): { representative: { category: string | undefined } } {
  return { representative: { category: item.category } };
}

function filteredItems(page: ListPage, filter?: string): ListItem[] {
  const groups = page.items.map(asGroup);
  const kept = new Set(filterGroups(groups, (filter ?? "all") as Filter));
  return page.items.filter((_, index) => kept.has(groups[index]!));
}

/** A filter choice per category that would show at least one card. Counts come
 * from the complete universe when the page carries them, so a capped list still
 * promises the real totals. */
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

/** The page token carried by a filter menu, which is the whole id after `filter:`. */
export function filterTokenFrom(customId: string): string | undefined {
  const match = /^filter:([^:]+)$/.exec(customId);
  return match?.[1];
}
