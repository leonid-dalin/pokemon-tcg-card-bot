import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normaliseName } from "./resolve.js";
import { setRecency } from "./set-index.js";

export interface TextPart {
  kind: "ability" | "attack" | "effect";
  name?: string;
  text: string;
}

export interface TextHit {
  id: string;
  name: string;
  text: string;
  /** Optional for compatibility with indexes that omit categories. */
  category?: "Pokemon" | "Trainer" | "Energy";
  /** Optional named sections for labelled result excerpts. */
  parts?: TextPart[];
}

export interface TextGroup {
  representative: TextHit;
  printings: number;
}

let cache: TextHit[] | undefined;

/**
 * Locates the index relative to this module in source and compiled layouts.
 * Compiled code reads the source copy because the build does not copy the JSON.
 */
function indexPath(): string {
  const candidates = [
    fileURLToPath(new URL("./data/text-index.json", import.meta.url)),
    fileURLToPath(new URL("../../src/data/text-index.json", import.meta.url)),
  ];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // Check the other supported layout.
    }
  }
  throw new Error("text-index.json is missing; run npm run index:text");
}

// Remove source markup while retaining inner text, including energy names.
function visible(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}

function load(): TextHit[] {
  if (cache) return cache;
  const raw = JSON.parse(readFileSync(indexPath(), "utf8")) as TextHit[];
  cache = raw.map((entry) => ({
    ...entry,
    text: visible(entry.text ?? ""),
    parts: entry.parts?.map((part) => ({ ...part, name: part.name === undefined ? undefined : visible(part.name), text: visible(part.text ?? "") })),
  }));
  return cache;
}

/** Returns the number of records in the loaded index. */
export function textIndexSize(): number {
  return load().length;
}

/** Returns normalised indexed wording, or undefined for an unknown ID. */
export function indexedText(id: string): string | undefined {
  const hit = load().find((entry) => entry.id === id);
  return hit ? normaliseName(hit.text) : undefined;
}

/**
 * Tokenises an unquoted query, excluding single-character words.
 */
function queryTokens(query: string): string[] {
  return normaliseName(query).match(WORD)?.filter((token) => token.length > 1) ?? [];
}

// Quoted phrases retain single-character words for adjacency checks.
function queryWords(query: string): string[] {
  return normaliseName(query).match(WORD) ?? [];
}

const normalisedCache = new WeakMap<object, string>();

// Internal apostrophes remain part of a word, as in "opponent's".
const WORD = /[a-z0-9]+(?:'[a-z0-9]+)*/g;

// Cache normalised visible text for both loaded and directly supplied records.
function normalisedText(card: TextHit): string {
  const cached = normalisedCache.get(card);
  if (cached !== undefined) return cached;
  const value = normaliseName(visible(card.text));
  normalisedCache.set(card, value);
  return value;
}

/**
 * Quote pairs recognised as a phrase delimiter around the entire query.
 */
export const WRAPPING_QUOTES: [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ["\u201c", "\u201d"],
  ["\u2018", "\u2019"],
];

/** Trims the query and removes one supported pair of outer quotes. */
export function unquote(query: string): string {
  const trimmed = query.trim();
  for (const [open, close] of WRAPPING_QUOTES) {
    if (trimmed.length >= 2 && trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(open.length, trimmed.length - close.length).trim();
    }
  }
  return trimmed;
}

const wordCache = new WeakMap<object, Set<string>>();

// Cache whole-word membership separately from ordered phrase text.
function wordsOf(card: TextHit): Set<string> {
  const cached = wordCache.get(card);
  if (cached) return cached;
  const words = new Set(normalisedText(card).match(WORD) ?? []);
  wordCache.set(card, words);
  return words;
}

/**
 * Joins normalised words for punctuation-independent adjacency checks.
 */
function phraseText(card: TextHit): string {
  return normalisedText(card).match(WORD)?.join(" ") ?? "";
}

function isPhrase(query: string): boolean {
  const trimmed = query.trim();
  return WRAPPING_QUOTES.some(([open, close]) => trimmed.length >= 2 && trimmed.startsWith(open) && trimmed.endsWith(close));
}

function findHits(entries: TextHit[], query: string): { card: TextHit; nameHits: number; exact: boolean }[] {
  const raw = unquote(query);
  const tokens = queryTokens(raw);
  const normalisedQuery = normaliseName(raw);
  const phrase = isPhrase(query) ? queryWords(raw).join(" ") : undefined;
  const hits: { card: TextHit; nameHits: number; exact: boolean }[] = [];

  for (const card of entries) {
    const nameWords = new Set(normaliseName(card.name).match(WORD) ?? []);
    let matchedAll: boolean;
    if (tokens.length === 0) {
      // Exact names such as N remain eligible when token filtering removes every word.
      matchedAll = phrase
        ? (` ${phraseText(card)} `).includes(` ${phrase} `) || normaliseName(card.name) === normalisedQuery
        : normaliseName(card.name) === normalisedQuery;
    } else if (phrase) {
      // Quoted queries match adjacent words or an exact card name.
      matchedAll = (` ${phraseText(card)} `).includes(` ${phrase} `) || normaliseName(card.name) === normalisedQuery;
    } else {
      const words = wordsOf(card);
      matchedAll = tokens.every((token) => words.has(token));
    }
    const nameHits = tokens.filter((token) => nameWords.has(token)).length;
    const nameMatches = !phrase && tokens.length > 0 && nameHits === tokens.length;
    if (!matchedAll && !nameMatches) continue;
    hits.push({ card, nameHits, exact: normaliseName(card.name) === normaliseName(raw) });
  }

  hits.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    const recency = setRecency(b.card.id) - setRecency(a.card.id);
    if (recency !== 0) return recency;
    if (a.nameHits !== b.nameHits) return b.nameHits - a.nameHits;
    if (a.card.text.length !== b.card.text.length) return a.card.text.length - b.card.text.length;
    return a.card.name.localeCompare(b.card.name);
  });
  return hits;
}

/** Searches indexed wording and names, returning ranked printing records. */
export function searchCardText(query: string, limit = Number.POSITIVE_INFINITY): TextHit[] {
  return findHits(load(), query)
    .slice(0, limit)
    .map(({ card }) => ({ id: card.id, name: card.name, text: card.text, category: card.category, parts: card.parts }));
}

/**
 * The newest card that carries exactly this name, if any. A short name such as
 * "N" cannot be searched upstream: the service treats it as a substring filter
 * and returns unrelated cards first, so the id comes from the local index.
 */
export function findExactCardName(query: string): TextHit | undefined {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return undefined;
  let best: TextHit | undefined;
  for (const entry of load()) {
    if (entry.name.trim().toLowerCase() !== wanted) continue;
    if (!best || entry.id > best.id) best = entry;
  }
  return best;
}

/** Groups matching index records by normalised card name. */
export function searchCardGroups(query: string): TextGroup[] {
  return searchGroupsIn(load(), query);
}

/** Searches supplied entries and groups matches by name using their newest printing. */
export function searchGroupsIn(entries: TextHit[], query: string): TextGroup[] {
  const groups = new Map<string, { card: TextHit; printings: number }>();
  for (const { card } of findHits(entries, query)) {
    const key = normaliseName(card.name);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { card, printings: 1 });
      continue;
    }
    group.printings += 1;
    if (setRecency(card.id) > setRecency(group.card.id)) group.card = card;
  }
  return [...groups.values()].map(({ card, printings }) => ({
    representative: { id: card.id, name: card.name, text: card.text, category: card.category, parts: card.parts },
    printings,
  }));
}

function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface RankedSentence {
  sentence: string;
  matches: number;
  index: number;
}

// Score query tokens by whole-word membership in the sentence.
function wordCount(sentence: string, tokens: string[]): number {
  const words = new Set(normaliseName(sentence).match(WORD) ?? []);
  return tokens.filter((token) => words.has(token)).length;
}

function rankSentences(text: string, tokens: string[]): RankedSentence[] {
  const ranked = splitSentences(text).map((sentence, index) => ({
    sentence,
    index,
    matches: wordCount(sentence, tokens),
  }));
  ranked.sort((a, b) => b.matches - a.matches || a.index - b.index);
  return ranked;
}

// Reserve room for bold markers before selecting the excerpt window.
function highlight(sentence: string, tokens: string[], maxLength: number): string {
  const highlightBudget = tokens.reduce((total, token) => {
    const count = normaliseName(sentence).split(token).length - 1;
    return total + count * 4;
  }, 0);
  const outputLimit = Math.max(0, maxLength - 1 - highlightBudget);
  const truncated = sentence.length > outputLimit;
  let excerpt = sentence;
  let cutAtStart = false;
  if (truncated) {
    // Position the window around the query match before trimming partial words.
    const first = firstMatchAt(sentence, tokens);
    const start = Math.max(0, Math.min(sentence.length - outputLimit, first - Math.floor(outputLimit / 3)));
    let slice = sentence.slice(start, start + outputLimit);
    if (start > 0) {
      const space = slice.indexOf(" ");
      slice = slice.slice(space > 0 ? space + 1 : 0);
      cutAtStart = true;
    }
    const spaceEnd = slice.lastIndexOf(" ");
    excerpt = spaceEnd > 0 ? slice.slice(0, spaceEnd) : slice;
  }
  // One replacement pass prevents overlapping terms from matching inserted markup.
  const alternation = [...new Set(tokens)]
    .filter((token) => token.length > 0)
    .sort((a, b) => b.length - a.length)
    .map((token) => `(?<![a-z0-9])${escapeRegExp(token)}(?![a-z0-9])`)
    .join("|");
  if (alternation) {
    excerpt = excerpt.replace(new RegExp(alternation, "gi"), (match) => `**${match}**`);
  }
  // Mark the omitted ends of a truncated excerpt.
  if (!truncated) return excerpt;
  return `${cutAtStart ? "…" : ""}${excerpt}…`;
}

/**
 * Finds an excerpt anchor in normalised text.
 * Prefers the complete query phrase, then a meaningful token, then any token.
 */
function firstMatchAt(sentence: string, tokens: string[]): number {
  const folded = normaliseName(sentence);
  const phrase = tokens.join(" ");
  const together = folded.indexOf(phrase);
  if (together >= 0) return together;
  const common = new Set(["of", "the", "a", "an", "and", "to", "in", "on"]);
  const meaningful = tokens.filter((token) => !common.has(token));
  const candidates = (meaningful.length > 0 ? meaningful : tokens)
    .map((token) => folded.indexOf(token))
    .filter((at) => at >= 0);
  return candidates.length > 0 ? Math.min(...candidates) : 0;
}

/** Formats the highest-scoring sentence as a bolded, length-limited excerpt. */
export function matchingSentence(text: string, query: string, maxLength = 160): string {
  const tokens = queryTokens(query);
  const selected = rankSentences(visible(text), tokens)[0]?.sentence ?? visible(text);
  return highlight(selected, tokens, maxLength);
}

function partLabel(part: TextPart): string {
  if (part.kind === "effect") return "Effect";
  const kind = part.kind === "ability" ? "Ability" : "Attack";
  return part.name ? `${kind} · ${part.name}` : kind;
}

function partText(part: TextPart): string {
  return [part.name, part.text]
    .filter((piece) => (piece ?? "").length > 0)
    .map((piece) => visible(piece!))
    .join(". ");
}

// Prefer a single phrase-bearing sentence, then the first matching sentence run.
function phraseSentence(part: TextPart, phrase: string): string | undefined {
  const sentences = splitSentences(partText(part));
  const runs = sentences.map((sentence) => (normaliseName(sentence).match(WORD) ?? []).join(" "));
  for (const [index, run] of runs.entries()) {
    if ((` ${run} `).includes(` ${phrase} `)) return sentences[index];
  }
  for (let start = 0; start < sentences.length; start += 1) {
    let run = "";
    for (let end = start; end < sentences.length; end += 1) {
      run = run ? `${run} ${runs[end]}` : runs[end]!;
      if ((` ${run} `).includes(` ${phrase} `)) return sentences.slice(start, end + 1).join(" ");
    }
  }
  return undefined;
}

/**
 * Formats a labelled excerpt from a matching ability, attack or effect.
 * Falls back to an unlabelled text excerpt when no part matches.
 */
export function matchingDetail(hit: TextHit, query: string, maxLength = 160): string {
  const raw = unquote(query);
  const tokens = queryTokens(raw);
  const quoted = isPhrase(query);
  const phrase = quoted ? queryWords(raw).join(" ") : undefined;
  let best: { part: TextPart; sentence: string; matches: number } | undefined;
  for (const part of hit.parts ?? []) {
    // Quoted excerpts use a phrase-bearing sentence within the selected part.
    if (phrase) {
      const chosen = phraseSentence(part, phrase);
      if (!chosen) continue;
      if (!best) best = { part, sentence: chosen, matches: tokens.length };
      continue;
    }
    for (const ranked of rankSentences(partText(part), tokens)) {
      if (!best || ranked.matches > best.matches) {
        best = { part, sentence: ranked.sentence, matches: ranked.matches };
      }
    }
  }
  if (!best || best.matches === 0) return matchingSentence(hit.text, query, maxLength);
  const label = partLabel(best.part);
  // Join matching sentences when one sentence does not contain every token.
  const sentence = best.matches === tokens.length
    ? best.sentence
    : spreadSentences(best.part, tokens) ?? best.sentence;
  const room = Math.max(40, maxLength - label.length - 2);
  // Phrase windows retain single-character words from the query.
  const shown = quoted ? phraseExcerpt(sentence, phrase!.split(" "), room) : highlight(sentence, tokens, room);
  return `${label}: ${shown}`;
}

// Return matching sentences in source order only when their union covers the query.
function spreadSentences(part: TextPart, tokens: string[]): string | undefined {
  const sentences = splitSentences(partText(part));
  const chosen = sentences.filter((sentence) => wordCount(sentence, tokens) > 0);
  if (chosen.length < 2) return undefined;
  const words = new Set(chosen.flatMap((sentence) => normaliseName(sentence).match(WORD) ?? []));
  if (!tokens.every((token) => words.has(token))) return undefined;
  return chosen.join(" … ");
}

// Position the excerpt around the complete phrase when it occurs literally.
function phraseExcerpt(text: string, tokens: string[], maxLength: number): string {
  const phrase = tokens.join(" ");
  const at = normaliseName(text).indexOf(phrase);
  if (at < 0) return highlight(text, tokens, maxLength);
  const before = Math.max(0, at - Math.floor((maxLength - phrase.length) / 2));
  const slice = text.slice(before, before + Math.max(phrase.length, maxLength));
  return highlight(slice, tokens, maxLength);
}
