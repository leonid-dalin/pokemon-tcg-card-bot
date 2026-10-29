export interface Mention {
  raw: string;
  name: string;
  setHint?: string;
  /** Set by the `!` prefix to request a scan-only reply. */
  imageOnly?: true;
}

const MENTION_PATTERN = /\[\[([^[\]]{1,80})\]\]/g;

// Exclude complete code blocks and inline code spans from mention matching.
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
}

/**
 * Extracts up to `limit` card mentions outside code spans and blocks.
 * Deduplicates by case-insensitive name, retaining the first hint and display mode.
 */
export function extractMentions(text: string, limit = 3): Mention[] {
  if (!text.includes("[[")) return [];
  const seen = new Set<string>();
  const mentions: Mention[] = [];

  for (const match of stripCode(text).matchAll(MENTION_PATTERN)) {
    const inner = (match[1] ?? "").trim();
    if (!inner) continue;

    // Use the first non-empty segment as the name and the last as the hint.
    const parts = inner.split("|").map((part) => part.trim()).filter(Boolean);
    const imageOnly = parts[0]?.startsWith("!") ?? false;
    const name = (parts[0] ?? "").replace(/^!/, "").replace(/\s+/g, " ");
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const setHint = parts.length > 1 ? parts[parts.length - 1] : undefined;
    mentions.push({
      raw: inner,
      name,
      ...(setHint ? { setHint } : {}),
      ...(imageOnly ? { imageOnly: true as const } : {}),
    });
    if (mentions.length >= limit) break;
  }

  return mentions;
}

/**
 * Parses a search command that mentions this bot.
 * Returns an empty string for a missing query, or undefined for unrelated text.
 */
export function parseSearchCommand(content: string, selfId: string): string | undefined {
  if (!content.includes("<@")) return undefined;
  const mentioned = new RegExp(`<@!?${selfId}>`).test(content);
  if (!mentioned) return undefined;

  const withoutMention = content.replace(/<@!?\d+>/g, " ").trim();
  const match = withoutMention.match(/^search\b[:\s]*(.*)$/i);
  if (!match) return undefined;
  return (match[1] ?? "").trim();
}

/**
 * Recognises a mention of this bot followed by no text or the word "help".
 */
export function parseHelpCommand(content: string, selfId: string): boolean {
  if (!content.includes("<@")) return false;
  if (!new RegExp(`<@!?${selfId}>`).test(content)) return false;
  const withoutMention = content.replace(/<@!?\d+>/g, " ").trim();
  return withoutMention === "" || /^help[.!]?$/i.test(withoutMention);
}

export type InlineCommand =
  | { command: "version"; argument: "" }
  | { command: "settings"; argument: "" }
  | { command: "printings"; argument: string }
  | { command: "set"; argument: string };

/**
 * Recognises a mention of this bot followed by one of the plain-text commands.
 * Returns undefined for unrelated text.
 */
export function parseInlineCommand(content: string, selfId: string): InlineCommand | undefined {
  if (!content.includes("<@")) return undefined;
  if (!new RegExp(`<@!?${selfId}>`).test(content)) return undefined;
  const withoutMention = content.replace(/<@!?\d+>/g, " ").trim();
  let match = withoutMention.match(/^version[.!]?$/i);
  if (match) return { command: "version", argument: "" };
  match = withoutMention.match(/^settings[.!]?$/i);
  if (match) return { command: "settings", argument: "" };
  match = withoutMention.match(/^printings\b[:\s]*(.+)$/i);
  if (match) return { command: "printings", argument: (match[1] ?? "").trim() };
  match = withoutMention.match(/^set\b[:\s]*(.+)$/i);
  if (match) return { command: "set", argument: (match[1] ?? "").trim() };
  return undefined;
}
