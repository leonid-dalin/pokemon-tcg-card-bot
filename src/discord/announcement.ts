/** Discord's limit for an embed description. */
const ANNOUNCEMENT_LIMIT = 4096;

/** Splits the change lines into embed descriptions that each fit Discord's limit. */
export function settingsAnnouncementChunks(lines: string[]): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    // A single over-long line is split rather than dropped.
    const pieces = line.length > ANNOUNCEMENT_LIMIT
      ? line.match(new RegExp(`[\\s\\S]{1,${ANNOUNCEMENT_LIMIT}}`, "g")) ?? []
      : [line];
    for (const piece of pieces) {
      const candidate = current ? `${current}\n${piece}` : piece;
      if (candidate.length > ANNOUNCEMENT_LIMIT) {
        if (current) chunks.push(current);
        current = piece;
      } else {
        current = candidate;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [""];
}

