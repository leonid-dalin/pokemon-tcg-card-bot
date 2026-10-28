import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from "discord.js";

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

export function listReply(page: ListPage, token: string, index: number, filter?: string): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
} {
  const items = filteredItems(page, filter);
  const current = clampIndex({ ...page, items }, index);
  const totalPages = Math.max(1, Math.ceil(items.length / page.perPage));
  const start = current * page.perPage;
  const shown = items.slice(start, start + page.perPage);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(page.title).setFooter({ text: page.footer });
  const description = shown.map((item) => `${item.heading}${item.detail ? `\n${item.detail}` : ""}`).join("\n\n");
  if (description) embed.setDescription(description);

  const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  if (totalPages > 1) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    row.addComponents(
      new ButtonBuilder().setCustomId(`page:${token}:${current - 1}:${filter ?? "all"}`).setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
      new ButtonBuilder().setCustomId(`page-label:${token}`).setLabel(`${current + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`page:${token}:${current + 1}:${filter ?? "all"}`).setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(current === totalPages - 1),
    );
    components.push(row as ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>);
  }

  if (page.filterable) {
    const choices = filterChoices(items);
    // A row that can only select the current category would not change the list.
    if (choices.length > 2) {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`filter:${token}`)
        .setPlaceholder("Show only")
        .addOptions(choices.map((choice) => ({ label: choice.label, value: choice.value, default: choice.value === (filter ?? "all") })));
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

function filteredItems(page: ListPage, filter?: string): ListItem[] {
  if (!filter || filter === "all") return page.items;
  return page.items.filter((item) => item.category === filter);
}

/** A filter choice per category that would show at least one card. */
function filterChoices(items: ListItem[]): { label: string; value: string }[] {
  const counts = new Map<string, number>();
  for (const item of items) if (item.category) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  const choices = [{ label: `${FILTER_LABELS.all} (${items.length})`, value: "all" }];
  for (const [category, count] of counts) {
    if (count > 0) choices.push({ label: `${FILTER_LABELS[category] ?? category} (${count})`, value: category });
  }
  return choices;
}

export function filterFrom(customId: string): string | undefined {
  const match = /^filter:[^:]+$/.exec(customId);
  return match ? customId.slice("filter:".length) : undefined;
}
