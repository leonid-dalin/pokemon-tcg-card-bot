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

    const [rawName = "", rawSet] = inner.split("|");
    const name = rawName.trim().replace(/\s+/g, " ");
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const setHint = rawSet?.trim();
    mentions.push(setHint ? { raw: inner, name, setHint } : { raw: inner, name });
    if (mentions.length >= limit) break;
  }

  return mentions;
}
