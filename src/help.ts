import type { EmbedView } from "./render.js";

const COLOUR = 0x5865f2;

/** Introductory text shared by slash-command and mention help replies. */
export const HELP_INTRO =
  "Mention the bot in any message, or run a slash command, and it answers with the card you asked for. The reply starts with the card front: HP, type, stage, what it evolves from, the attacks with their costs, weakness and retreat. Press `Details` for the set, rarity, illustrator, legality and prices.";

const COMMANDS: { name: string; value: string }[] = [
  { name: "/card name:<name> [set:<hint>]", value: "shows one card. The hint can be a set id, a printed code or a set name" },
  { name: "/printings name:<name>", value: "lists every printing of that name, newest first" },
  { name: "/set id:<set id>", value: "shows the set: card count, series and release date" },
  { name: "/set id:<set id> checklist:true", value: "lists every card in the set" },
  { name: "/search text:<words>", value: "finds cards whose ability, attack or Trainer wording contains every word" },
  { name: "/help", value: "shows this card" },
  { name: "/version", value: "the running revision, uptime and version" },
  { name: "/settings", value: "for server admins: choose where and what the bot replies to" },
];

export const MENTIONS_VALUE = [
  "`[[Card name]]` answers with the card, up to three in one message",
  "`[[Card name|sv07]]` picks a printing: a set id, a printed code or a set name",
  "`[[Card name|pocket]]` picks the Pocket version",
  "`[[!Card name]]` answers with the scan alone",
  "`@bot search <words>` runs the same search from the message box",
  "`@bot printings <name>`, `@bot set <id>`, `@bot version` and `@bot settings` mirror those commands",
].join("\n");

export const NOTES_VALUE = [
  "Only the person who asked can swap a printing or turn a page, so a shared reply stays put",
  "Names match regardless of case, accents and apostrophes",
  "Anything inside backticks is left alone, so you can explain the syntax in the same channel",
].join("\n");

export function helpView(): EmbedView {
  return {
    title: "Pokémon TCG card bot",
    color: COLOUR,
    description: HELP_INTRO,
    fields: [
      { name: "Commands", value: COMMANDS.map((entry) => `\`${entry.name}\` ${entry.value}`).join("\n") },
      { name: "In any message", value: MENTIONS_VALUE },
      { name: "Worth knowing", value: NOTES_VALUE },
    ],
  };
}
