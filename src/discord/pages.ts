import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from "discord.js";

export interface ListItem {
  cardId: string;
  heading: string;
  detail?: string;
}

export interface ListPage {
  title: string;
  items: ListItem[];
  perPage: number;
  ownerId: string;
  footer: string;
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
  const page = /^page:([^:]+):\d+$/.exec(customId);
  const open = /^open:([^:]+)$/.exec(customId);
  return page?.[1] ?? open?.[1];
}

export function pageIndexFrom(customId: string): number | undefined {
  const match = /^page:[^:]+:(\d+)$/.exec(customId);
  return match ? Number(match[1]) : undefined;
}

export function listReply(page: ListPage, token: string, index: number): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
} {
  const current = clampIndex(page, index);
  const totalPages = Math.max(1, Math.ceil(page.items.length / page.perPage));
  const start = current * page.perPage;
  const items = page.items.slice(start, start + page.perPage);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(page.title).setFooter({ text: page.footer });
  const description = items.map((item) => `${item.heading}${item.detail ? `\n${item.detail}` : ""}`).join("\n\n");
  if (description) embed.setDescription(description);

  const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  if (totalPages > 1) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    row.addComponents(
      new ButtonBuilder().setCustomId(`page:${token}:${current - 1}`).setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
      new ButtonBuilder().setCustomId(`page-label:${token}`).setLabel(`${current + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`page:${token}:${current + 1}`).setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(current === totalPages - 1),
    );
    components.push(row as ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>);
  }

  if (items.length > 0) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`open:${token}`)
      .setPlaceholder("Open a card")
      .addOptions(items.map((item) => ({ label: item.heading.replace(/\*\*/g, "").slice(0, 100), value: item.cardId })));
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu) as ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>);
  }

  return { embeds: [embed], components };
}
