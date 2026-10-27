export interface Mention {
  raw: string;
  name: string;
  setHint?: string;
}

const MENTION_PATTERN = /\[\[([^[\]]{1,80})\]\]/g;

/** Remove fenced blocks and inline code so documentation examples never fire. */
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
}

/**
 * Pull `[[Card Name]]` and `[[Card Name|setId]]` out of message text.
 * Duplicates are dropped case-insensitively and the result is capped so one
 * enthusiastic message cannot turn into a wall of embeds.
 */
export function extractMentions(text: string, limit = 3): Mention[] {
  if (!text.includes("[[")) return [];
  const seen = new Set<string>();
  const mentions: Mention[] = [];

  for (const match of stripCode(text).matchAll(MENTION_PATTERN)) {
    const inner = (match[1] ?? "").trim();
    if (!inner) continue;

    // A doubled pipe is common (Discord habits, or just a slip). Keep the first
    // segment as the name and the last non-empty one as the hint, so
    // "crustle||ptcgp" still reaches Pocket instead of silently dropping it.
    const parts = inner.split("|").map((part) => part.trim()).filter(Boolean);
    const name = (parts[0] ?? "").replace(/\s+/g, " ");
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const setHint = parts.length > 1 ? parts[parts.length - 1] : undefined;
    mentions.push(setHint ? { raw: inner, name, setHint } : { raw: inner, name });
    if (mentions.length >= limit) break;
  }

  return mentions;
}

/**
 * Read `@bot search <text>` from a message. Returns the query, an empty string
 * when the command was used with no text, and undefined when the message is not
 * a search command aimed at this bot.
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
