# Using the bot

Use these commands in a Discord server where the bot is installed. Ordinary-message replies depend on the host and [server settings](server-settings.md)

## Commands

| Command | Result |
| --- | --- |
| `/card name:<name> [set:<hint>]` | One card, with name autocomplete and an optional set or printing hint |
| `/printings name:<name>` | Same-name printings, newest first |
| `/set id:<set id>` | Set summary; add `checklist:true` for its card list |
| `/search text:<words>` | Search indexed card names and rules text; quote a phrase to match adjacent words |
| `/help` | Command and message examples |
| `/settings` | Opens a private panel for server preferences and your own choices |

## Card mentions

In chat, use `[[Card name]]`, with up to three distinct names per message. Add a set ID, printed set code or set name after `|` to choose a printing, such as `[[Charizard ex|sv03]]`. An exact card ID also works: `[[Dragapult ex|sv08.5-073]]`

Use `pocket`, `ptcgp` or `tcgp` as the hint for Pocket cards, or `[[!Card name]]` for the scan alone. Names tolerate differences in case, accents and apostrophes. Card mentions inside inline code or code blocks are ignored

## Help and message search

Mention the bot's actual account for the `@bot` examples. A bare mention or `@bot help` opens help; `@bot search <words>` runs wording search, and `@bot printings <name>`, `@bot set <id>`, `@bot version` and `@bot settings` mirror their slash commands

## Decklists

Pasted decklists can show card counts, Standard legality and available Cardmarket prices. A server administrator must enable [decklist replies](server-settings.md#replies) first

## Reply controls

Card replies show the scan, stats and rules text. Printing buttons change the card in place; `Details` opens set information, legality and available prices in a private reply. Only the person who requested a card or list can change its printing or page

Paged lists expire after fifteen minutes and are cleared on restart. Run the command again to create a new list

## Data and limits

Physical card records, legality and prices come from [TCGdex](https://tcgdex.dev). Pocket records come from the installed [pokemon-tcg-pocket-cards](https://github.com/chase-mew/pokemon-tcg-pocket-cards) package. Wording search uses a checked-in index, which can lag new releases; [data maintenance](data-maintenance.md) explains how to refresh it

Prices appear only when the source provides them. Default reply settings allow both card games and prefer the physical game for an ambiguous card name

## If a reply is missing

- For ordinary-message replies, ask a server administrator to check reply switches and selected channels
- In a thread, the bot needs Send Messages in Threads and uses the parent channel's selection
- For missing or outdated slash commands, the operator must register the command definitions again

[Server settings](server-settings.md) explains what administrators can change. [Setup](setup.md) covers host-side checks
